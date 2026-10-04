package main

import (
	"flag"
	"fmt"
	"image/jpeg"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/jdeng/goheif"
	"github.com/jdeng/goheif/heif"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("heic-jpg", flag.ContinueOnError)
	flags.SetOutput(stderr)
	quality := flags.Int("quality", 85, "JPEG quality (1–100)")
	overwrite := flags.Bool("overwrite", false, "replace existing JPEG files")
	flags.Usage = func() {
		fmt.Fprintln(stderr, "Usage: heic-jpg [options] <file-or-pattern> ...\nExample: heic-jpg 'photos/*.HEIC'")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}
	if flags.NArg() == 0 {
		flags.Usage()
		return 1
	}
	if *quality < 1 || *quality > 100 {
		fmt.Fprintln(stderr, "quality must be between 1 and 100")
		return 1
	}
	seen := make(map[string]bool)
	failed := false
	for _, pattern := range flags.Args() {
		// Prefer literal paths so filenames containing glob characters work too.
		matches := []string{pattern}
		if _, err := os.Stat(pattern); err != nil {
			var globErr error
			matches, globErr = filepath.Glob(pattern)
			if globErr != nil {
				fmt.Fprintf(stderr, "%s: %v\n", pattern, globErr)
				failed = true
				continue
			}
		}
		if len(matches) == 0 {
			fmt.Fprintf(stderr, "%s: no files matched\n", pattern)
			failed = true
			continue
		}
		for _, input := range matches {
			absolute, err := filepath.Abs(input)
			if err != nil {
				fmt.Fprintln(stderr, err)
				failed = true
				continue
			}
			if seen[absolute] {
				continue
			}
			seen[absolute] = true
			ext := filepath.Ext(input)
			if !strings.EqualFold(ext, ".heic") && !strings.EqualFold(ext, ".heif") {
				fmt.Fprintf(stderr, "%s: expected a .heic or .heif file\n", input)
				failed = true
				continue
			}
			output := strings.TrimSuffix(input, ext) + ".jpg"
			if err := convert(input, output, *quality, *overwrite); err != nil {
				fmt.Fprintf(stderr, "%s: %v\n", input, err)
				failed = true
				continue
			}
			fmt.Fprintf(stdout, "%s -> %s\n", input, output)
		}
	}
	if failed {
		return 1
	}
	return 0
}

func convert(input, output string, quality int, overwrite bool) error {
	if !overwrite {
		if _, err := os.Lstat(output); err == nil {
			return fmt.Errorf("%s already exists (use -overwrite to replace it)", output)
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	in, err := os.Open(input)
	if err != nil {
		return err
	}
	defer in.Close()
	img, err := goheif.Decode(in)
	if err != nil {
		return fmt.Errorf("decode HEIC: %w", err)
	}
	item, err := heif.Open(in).PrimaryItem()
	if err != nil {
		return fmt.Errorf("read HEIC orientation: %w", err)
	}
	img = applyOrientation(img, item.Properties)
	// Encode to a temporary file so failed conversions never leave partial JPEGs.
	tmp, err := os.CreateTemp(filepath.Dir(output), ".heic-jpg-*.jpg")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := jpeg.Encode(tmp, img, &jpeg.Options{Quality: quality}); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0644); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if overwrite {
		return os.Rename(tmp.Name(), output)
	}
	// Linking publishes the complete file without replacing a concurrent writer.
	if err := os.Link(tmp.Name(), output); err != nil {
		return fmt.Errorf("create %s: %w", output, err)
	}
	return nil
}
