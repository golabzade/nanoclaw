---
name: pdf-reader
description: Read text from PDF files. Use when the user sends a PDF or asks to read one from a URL.
allowed-tools: Bash
---

# Reading PDFs

## PDF sent via Telegram

PDFs sent as documents are saved to `/workspace/group/uploads/`. Extract text with:

```bash
pdftotext "/workspace/group/uploads/filename.pdf" -
```

## PDF from a URL

```bash
curl -sLo /tmp/doc.pdf "<url>" && pdftotext /tmp/doc.pdf -
```

## Get page count / metadata

```bash
pdfinfo "/workspace/group/uploads/filename.pdf"
```

## Notes

- `pdftotext` only works on text-based PDFs. Scanned PDFs (image-only) will return empty — use `agent-browser` to open them visually instead.
- The `-` at the end prints to stdout.
