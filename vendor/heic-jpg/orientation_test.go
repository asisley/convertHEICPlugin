package main

import (
	"image"
	"image/color"
	"testing"

	"github.com/jdeng/goheif/heif/bmff"
)

func TestOrientation(t *testing.T) {
	// Non-square pixels and a nonzero origin catch direction and offset mistakes.
	src := image.NewGray(image.Rect(5, 7, 8, 9))
	for y := 0; y < 2; y++ {
		for x := 0; x < 3; x++ {
			src.SetGray(x+5, y+7, color.Gray{Y: uint8(y*3 + x + 1)})
		}
	}
	tests := []struct {
		name       string
		properties []bmff.Box
		width      int
		pixels     []uint8
	}{
		{"unchanged", nil, 3, []uint8{1, 2, 3, 4, 5, 6}},
		{"counterclockwise", []bmff.Box{&bmff.ImageRotation{Angle: 1}}, 2, []uint8{3, 6, 2, 5, 1, 4}},
		{"half-turn", []bmff.Box{&bmff.ImageRotation{Angle: 2}}, 3, []uint8{6, 5, 4, 3, 2, 1}},
		{"clockwise", []bmff.Box{&bmff.ImageRotation{Angle: 3}}, 2, []uint8{4, 1, 5, 2, 6, 3}},
		{"vertical-axis", []bmff.Box{&bmff.ImageMirror{Mirror: bmff.MirrorVertical}}, 3, []uint8{3, 2, 1, 6, 5, 4}},
		{"horizontal-axis", []bmff.Box{&bmff.ImageMirror{Mirror: bmff.MirrorHorizontal}}, 3, []uint8{4, 5, 6, 1, 2, 3}},
		{"rotate-then-mirror", []bmff.Box{&bmff.ImageRotation{Angle: 3}, &bmff.ImageMirror{Mirror: bmff.MirrorVertical}}, 2, []uint8{1, 4, 2, 5, 3, 6}},
		{"mirror-then-rotate", []bmff.Box{&bmff.ImageMirror{Mirror: bmff.MirrorVertical}, &bmff.ImageRotation{Angle: 3}}, 2, []uint8{6, 3, 5, 2, 4, 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := applyOrientation(src, tt.properties)
			b := got.Bounds()
			if b.Dx() != tt.width || b.Dy() != len(tt.pixels)/tt.width {
				t.Fatalf("bounds: %v", b)
			}
			for i, want := range tt.pixels {
				actual := color.GrayModel.Convert(got.At(b.Min.X+i%tt.width, b.Min.Y+i/tt.width)).(color.Gray).Y
				if actual != want {
					t.Fatalf("pixel %d: got %d, want %d", i, actual, want)
				}
			}
		})
	}
}
