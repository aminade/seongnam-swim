#!/usr/bin/env python3
"""공지 첨부 문서 → 평문 텍스트 / 이미지 (로컬 전용, 네트워크·API 없음).

사용:
  doc_tools.py pdf-text  <file.pdf>            PDF 글자 추출(stdout). 실패 시 exit 2.
  doc_tools.py pdf-render <file.pdf> <outdir>  스캔 PDF를 페이지별 PNG로(최대 4쪽). 만든 경로를 한 줄씩 출력.
  doc_tools.py hwpx-text <file.hwpx>           HWPX(zip+XML) 본문 글자 추출.

한컴(HWP)에서 내보낸 PDF는 BaseFont 인코딩이 비표준이라 pdfminer/pdfplumber가 죽는 경우가 있다.
Chrome 엔진인 PDFium(pypdfium2)이 이를 견디므로 1차로 쓰고, 실패 시 pdfplumber로 폴백한다.
HWP(바이너리)는 pyhwp의 hwp5html 로 따로 처리한다(표 안 글자까지 나옴 — hwp5txt는 표를 건너뜀).
"""
import os
import re
import sys
import zipfile


def pdf_text(path):
    text = ""
    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(path)
        text = "\n".join(pdf[i].get_textpage().get_text_range() for i in range(len(pdf)))
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"pdfium 실패: {e}\n")
    if not text.strip():
        try:
            import pdfplumber
            with pdfplumber.open(path) as pdf:
                text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"pdfplumber 실패: {e}\n")
    return text


def pdf_render(path, outdir, max_pages=4):
    import pypdfium2 as pdfium
    os.makedirs(outdir, exist_ok=True)
    pdf = pdfium.PdfDocument(path)
    base = os.path.splitext(os.path.basename(path))[0]
    for i in range(min(len(pdf), max_pages)):
        out = os.path.join(outdir, f"{base}.p{i}.png")
        pdf[i].render(scale=2).to_pil().save(out)
        print(out)


def hwpx_text(path):
    parts = []
    with zipfile.ZipFile(path) as z:
        for name in sorted(n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n)):
            xml = z.read(name).decode("utf-8", "ignore")
            xml = re.sub(r"</hp:p>", "\n", xml)
            parts.append(re.sub(r"<[^>]+>", " ", xml))
    return re.sub(r"[ \t]+", " ", "\n".join(parts))


def main():
    if len(sys.argv) < 3:
        sys.stderr.write(__doc__)
        sys.exit(2)
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "pdf-text":
        text = pdf_text(path)
        if not text.strip():
            sys.exit(2)
        sys.stdout.write(text)
    elif cmd == "pdf-render":
        pdf_render(path, sys.argv[3])
    elif cmd == "hwpx-text":
        sys.stdout.write(hwpx_text(path))
    else:
        sys.stderr.write(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
