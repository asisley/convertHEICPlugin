import AppKit
import ImageIO
import UniformTypeIdentifiers
let dir = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
let width = 400, height = 240
let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width*4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(NSColor.white.cgColor);ctx.fill(CGRect(x:0,y:0,width:width,height:height))
ctx.setFillColor(NSColor.systemRed.cgColor);ctx.fill(CGRect(x:0,y:120,width:200,height:120))
ctx.setFillColor(NSColor.systemGreen.cgColor);ctx.fill(CGRect(x:200,y:120,width:200,height:120))
ctx.setFillColor(NSColor.systemBlue.cgColor);ctx.fill(CGRect(x:0,y:0,width:200,height:120))
ctx.setFillColor(NSColor.systemYellow.cgColor);ctx.fill(CGRect(x:200,y:0,width:200,height:120))
let image = ctx.makeImage()!
for (name,orientation) in [("sample.HEIC",1),("rotated.heic",6)] {
  let dest = CGImageDestinationCreateWithURL(dir.appendingPathComponent(name) as CFURL, UTType.heic.identifier as CFString,1,nil)!
  CGImageDestinationAddImage(dest,image,[kCGImageDestinationLossyCompressionQuality:0.95,kCGImagePropertyOrientation:orientation] as CFDictionary)
  guard CGImageDestinationFinalize(dest) else { fatalError("Could not create HEIC fixture") }
}
