# heic-jpg

Convert HEIC/HEIF files to JPEG using [goheif](https://github.com/jdeng/goheif), with the same decoder version and default quality (85) used by Gateway.

## Build

Requires Go 1.27 or later and a C/C++ compiler (goheif uses cgo). On macOS, install the compiler with `xcode-select --install` if needed.

```sh
make build
```

## Use

```sh
./bin/heic-jpg 'photos/*.HEIC'
./bin/heic-jpg photos/*.heic
./bin/heic-jpg photo1.HEIC photo2.heic
./bin/heic-jpg -quality 95 -overwrite 'photos/*.[hH][eE][iI][cC]'
```

`photos/IMG_1234.HEIC` becomes `photos/IMG_1234.jpg`. Originals are kept. Existing JPEGs are protected unless `-overwrite` is given. Options must come before filenames.

Quote patterns to have the CLI expand them. Patterns use Go's `filepath.Glob` syntax (`*`, `?`, character classes); matching is case sensitive and `**` does not recursively search directories. File extensions are accepted in any case. Overlapping patterns process each path once.

Each successful conversion prints its input and output paths. Errors go to stderr, remaining files are still processed, and any error gives a nonzero exit status. HEIC rotation and mirroring properties are applied to the pixels so JPEGs display in the intended orientation. JPEG output does not copy EXIF metadata.

To make the command available on your PATH, run `go install .` and add your Go binary directory (usually `~/go/bin`) to PATH.

```sh
make test
```
