import AppKit
import UniformTypeIdentifiers

final class DropView: NSView {
    var receive: (([URL]) -> Void)?
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 18
        layer?.borderWidth = 2
        layer?.borderColor = NSColor.separatorColor.cgColor
        layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        registerForDraggedTypes([.fileURL])
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        layer?.borderColor = NSColor.systemGreen.cgColor
        return .copy
    }
    override func draggingExited(_ sender: NSDraggingInfo?) { layer?.borderColor = NSColor.separatorColor.cgColor }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        layer?.borderColor = NSColor.separatorColor.cgColor
        guard let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] else { return false }
        receive?(urls)
        return true
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var status: NSTextField!
    var chooseButton: NSButton!
    var copyButton: NSButton!
    var revealButton: NSButton!
    var responsePath: String?
    var completed = false
    var busy = false
    var outputs: [URL] = []
    var worker: Process?
    var pending: [URL] = []

    func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        field.alignment = .center
        return field
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--response"), args.count > i + 1 { responsePath = args[i + 1] }
        window = NSWindow(contentRect: NSRect(x: 0,y: 0,width: 550,height: 485), styleMask: [.titled,.closable,.miniaturizable], backing: .buffered, defer: false)
        window.title = "convertHEIC"
        window.delegate = self
        window.isReleasedWhenClosed = false
        let content = window.contentView!
        let root = NSStackView()
        root.orientation = .vertical; root.spacing = 12; root.alignment = .centerX
        root.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(root)
        NSLayoutConstraint.activate([root.leadingAnchor.constraint(equalTo: content.leadingAnchor,constant: 28),root.trailingAnchor.constraint(equalTo: content.trailingAnchor,constant: -28),root.topAnchor.constraint(equalTo: content.topAnchor,constant: 26)])
        root.addArrangedSubview(label("HEIC → JPEG",size: 26,weight: .semibold))
        root.addArrangedSubview(label(responsePath == nil ? "iPhone photos, ready for Codex." : "Connected to Codex · Drop photos to continue your request.",size: 13))
        let drop = DropView(frame: .zero)
        drop.translatesAutoresizingMaskIntoConstraints = false
        root.addArrangedSubview(drop)
        drop.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true
        drop.heightAnchor.constraint(equalToConstant: 190).isActive = true
        let inner = NSStackView()
        inner.orientation = .vertical; inner.spacing = 12; inner.alignment = .centerX
        inner.translatesAutoresizingMaskIntoConstraints = false; drop.addSubview(inner)
        NSLayoutConstraint.activate([inner.centerXAnchor.constraint(equalTo: drop.centerXAnchor),inner.centerYAnchor.constraint(equalTo: drop.centerYAnchor)])
        inner.addArrangedSubview(label("Drop HEIC photos here",size: 20,weight: .medium))
        inner.addArrangedSubview(label("Up to 4 photos · 64 MB each",size: 12))
        chooseButton = NSButton(title: "Choose photos…",target: self,action: #selector(choose))
        chooseButton.bezelStyle = .rounded
        inner.addArrangedSubview(chooseButton)
        drop.receive = { [weak self] urls in self?.receive(urls) }
        status = label("Conversion stays on your Mac. Originals stay unchanged.",size: 13)
        root.addArrangedSubview(status)
        status.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true
        let buttons = NSStackView(); buttons.orientation = .horizontal; buttons.spacing = 8
        copyButton = NSButton(title: "Copy JPEGs",target: self,action: #selector(copyJPEGs));copyButton.bezelStyle = .rounded;copyButton.isEnabled = false
        revealButton = NSButton(title: "Show JPEGs in Finder",target: self,action: #selector(reveal));revealButton.bezelStyle = .rounded;revealButton.isEnabled = false
        buttons.addArrangedSubview(copyButton);buttons.addArrangedSubview(revealButton)
        if responsePath == nil { root.addArrangedSubview(buttons) }
        let cancel = NSButton(title: responsePath == nil ? "Close" : "Cancel",target: self,action: #selector(close));cancel.bezelStyle = .rounded
        root.addArrangedSubview(cancel)
        window.center();window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if !pending.isEmpty { receive(pending);pending = [] }
    }
    @objc func choose() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.heic, .heif]
        panel.allowsMultipleSelection = true;panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { [weak self] result in
            if result == .OK { self?.receive(panel.urls) }
        }
    }
    func receive(_ urls: [URL]) {
        guard !busy else { return }
        guard !urls.isEmpty && urls.count <= 4 else { status.stringValue = "Choose one to four HEIC photos."; return }
        guard urls.allSatisfy({ ["heic","heif"].contains($0.pathExtension.lowercased()) }) else { status.stringValue = "Choose .heic or .heif files."; return }
        guard urls.allSatisfy({ let v = try? $0.resourceValues(forKeys: [.isRegularFileKey,.fileSizeKey]); return v?.isRegularFile == true && (v?.fileSize ?? 0) > 0 && (v?.fileSize ?? Int.max) <= 64*1024*1024 }) else { status.stringValue = "Each photo must be a local file no larger than 64 MB."; return }
        if responsePath != nil {
            do { try respond(["paths": urls.map(\.path)]); completed = true; NSApp.terminate(nil) }
            catch { status.stringValue = "Could not hand files to Codex: \(error.localizedDescription)" }
            return
        }
        busy = true;chooseButton.isEnabled = false;copyButton.isEnabled = false;revealButton.isEnabled = false
        status.stringValue = "Converting \(urls.count) photo(s) on your Mac…"
        let process = Process(), pipe = Pipe()
        process.executableURL = Bundle.main.resourceURL!.appendingPathComponent("converter/bin/launch")
        process.arguments = ["--convert"] + urls.map(\.path)
        process.standardOutput = pipe;process.standardError = FileHandle.nullDevice
        worker = process
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try process.run()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                let files = value?["files"] as? [[String:Any]] ?? []
                let errors = value?["errors"] as? [[String:Any]] ?? []
                let outputs = files.compactMap { $0["jpegPath"] as? String }.map { URL(fileURLWithPath: $0) }
                DispatchQueue.main.async {
                    self.outputs = outputs;self.busy = false;self.worker = nil;self.chooseButton.isEnabled = true
                    self.copyButton.isEnabled = !outputs.isEmpty;self.revealButton.isEnabled = !outputs.isEmpty
                    if !errors.isEmpty { self.status.stringValue = "\(outputs.count) converted. " + (errors.first?["error"] as? String ?? "A photo could not be decoded.") }
                    else { self.status.stringValue = "\(outputs.count) JPEG(s) ready. Copy them, then paste into Codex." }
                }
            } catch {
                DispatchQueue.main.async {self.busy = false;self.worker = nil;self.chooseButton.isEnabled = true;self.status.stringValue = error.localizedDescription}
            }
        }
    }
    func respond(_ object: [String: Any]) throws {
        guard let responsePath else { return }
        try JSONSerialization.data(withJSONObject: object).write(to: URL(fileURLWithPath: responsePath),options: .atomic)
    }
    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        let urls = filenames.map { URL(fileURLWithPath: $0) }
        if window == nil { pending = urls } else { receive(urls) }
        sender.reply(toOpenOrPrint: .success)
    }
    @objc func copyJPEGs() { NSPasteboard.general.clearContents();NSPasteboard.general.writeObjects(outputs as [NSURL]);status.stringValue = "JPEGs copied. Paste into Codex with ⌘V." }
    @objc func reveal() { NSWorkspace.shared.activateFileViewerSelecting(outputs) }
    @objc func close() { window.close() }
    func windowWillClose(_ notification: Notification) { if !completed { try? respond(["cancelled":true]) }; worker?.terminate();NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { if !completed { try? respond(["cancelled":true]) }; worker?.terminate() }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
