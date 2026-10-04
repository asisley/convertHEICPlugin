# HEIC converter source

`heic-jpg/` is the unmodified source from [wilsonweightlifting/heic-jpg](https://github.com/wilsonweightlifting/heic-jpg), commit `6553332e47f0ee749985ced96fcce5979e208365`.

Its MIT license is retained in `heic-jpg/LICENSE` and in the plugin root as `CLI-LICENSE.txt`. The dependency versions are pinned by its `go.mod` and `go.sum`.

The plugin includes a prebuilt Apple Silicon converter in `bin/heic-jpg`. To rebuild it with the Go toolchain required by the upstream `go.mod` and macOS command-line tools, run from this repository root:

```sh
cd vendor/heic-jpg
go test ./...
go build -trimpath -o ../../bin/heic-jpg .
```

Run the plugin integration tests after replacing the binary. Plugin-specific logic lives in `src/`, `ui/`, and `native/`.
