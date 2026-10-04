package main

import (
	"image"
	"image/color"

	"github.com/jdeng/goheif/heif/bmff"
)

// goheif decodes stored pixels without applying HEIF display transforms.
// Apply only the primary image's explicit properties, in their declared order.
func applyOrientation(src image.Image, properties []bmff.Box) image.Image {
	for _, property := range properties {
		switch p := property.(type) {
		case *bmff.ImageRotation:
			if p.Angle != 0 {
				src = orientedImage{source: src, rotation: int(p.Angle)}
			}
		case *bmff.ImageMirror:
			src = orientedImage{source: src, mirror: true, axis: p.Mirror}
		}
	}
	return src
}

// A coordinate view avoids allocating another full-size image.
type orientedImage struct {
	source   image.Image
	rotation int
	mirror   bool
	axis     uint8
}

func (im orientedImage) ColorModel() color.Model { return im.source.ColorModel() }

func (im orientedImage) Bounds() image.Rectangle {
	b := im.source.Bounds()
	w, h := b.Dx(), b.Dy()
	if im.rotation%2 != 0 {
		w, h = h, w
	}
	return image.Rect(0, 0, w, h)
}

func (im orientedImage) At(x, y int) color.Color {
	if !image.Pt(x, y).In(im.Bounds()) {
		return color.NRGBA{}
	}
	b := im.source.Bounds()
	w, h := b.Dx(), b.Dy()
	if im.mirror {
		if im.axis == bmff.MirrorVertical {
			x = w - 1 - x
		} else {
			y = h - 1 - y
		}
	} else {
		switch im.rotation {
		case 1:
			x, y = w-1-y, x
		case 2:
			x, y = w-1-x, h-1-y
		case 3:
			x, y = y, h-1-x
		}
	}
	return im.source.At(b.Min.X+x, b.Min.Y+y)
}
