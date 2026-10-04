package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestRunValidation(t *testing.T) {
	for _, args := range [][]string{nil, {"-quality", "0", "a.heic"}, {"-quality", "101", "a.heic"}, {"missing-*.heic"}, {"["}} {
		var out, err bytes.Buffer
		if run(args, &out, &err) != 1 || err.Len() == 0 {
			t.Fatalf("args %v: expected an error, got %q", args, err.String())
		}
	}
}

func TestExistingOutputProtected(t *testing.T) {
	dir := t.TempDir()
	input, output := filepath.Join(dir, "photo.HEIC"), filepath.Join(dir, "photo.jpg")
	if err := os.WriteFile(input, []byte("invalid HEIC"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output, []byte("keep me"), 0644); err != nil {
		t.Fatal(err)
	}
	var out, errors bytes.Buffer
	if run([]string{input}, &out, &errors) != 1 {
		t.Fatal("expected failure")
	}
	data, err := os.ReadFile(output)
	if err != nil || string(data) != "keep me" {
		t.Fatalf("existing output changed: %q, %v", data, err)
	}
}

func TestFailedDecodeLeavesNoOutput(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "broken.heic")
	if err := os.WriteFile(input, []byte("invalid"), 0644); err != nil {
		t.Fatal(err)
	}
	var out, errors bytes.Buffer
	if run([]string{input}, &out, &errors) != 1 {
		t.Fatal("expected failure")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("unexpected files: %v, %v", entries, err)
	}
}
