"""Author synthetic demo PDFs. Tool-only dependencies: reportlab, pymupdf, pypdf."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether
from reportlab.lib.enums import TA_LEFT
import fitz
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/pdf/hospital"
PREVIEW = ROOT / "test-results/hospital-demo/pdf-preview"
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
styles = {
    "title": ParagraphStyle("title", fontName="STSong-Light", fontSize=23, leading=34, textColor=colors.HexColor("#103f44"), spaceAfter=14),
    "heading": ParagraphStyle("heading", fontName="STSong-Light", fontSize=13, leading=21, textColor=colors.HexColor("#0f766e"), spaceAfter=7),
    "body": ParagraphStyle("body", fontName="STSong-Light", fontSize=10.5, leading=20, alignment=TA_LEFT, wordWrap="CJK", textColor=colors.HexColor("#334155"), spaceAfter=17),
    "meta": ParagraphStyle("meta", fontName="STSong-Light", fontSize=10, leading=19, textColor=colors.HexColor("#64748b"), spaceAfter=20),
}

def frame(canvas: Canvas, doc):
    canvas.setFillColor(colors.HexColor("#0f766e"))
    canvas.rect(44, 790, 507, 4, fill=1, stroke=0)
    canvas.setFont("STSong-Light", 9)
    canvas.drawString(44, 808, "MedPM-AI / 医疗软件交付演示")
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.drawString(44, 32, "合成演示资料 | 不含真实患者信息 | 审批记录请以系统审计为准")
    canvas.drawRightString(551, 32, f"{doc.page}")

documents = json.loads((ROOT / "prisma/demo-assets/hospital/documents.json").read_text(encoding="utf-8"))
for item in documents:
    path = OUT / f"{item['key']}.pdf"
    flow = [Paragraph(escape(item["name"]), styles["title"]), Paragraph(f"XX市第一人民医院EMR系统交付<br/>{item['code']} · V1.0 · 合成演示基线", styles["meta"])]
    for n, (heading, body) in enumerate(item["sections"], 1):
        flow.append(KeepTogether([Paragraph(f"{n:02d} / {escape(heading)}", styles["heading"]), Paragraph(escape(body), styles["body"])]))
    SimpleDocTemplate(str(path), pagesize=(595.28, 841.89), leftMargin=44, rightMargin=44, topMargin=68, bottomMargin=60, title=item["name"], author="MedPM-AI Synthetic Demo").build(flow, onFirstPage=frame, onLaterPages=frame)
    pdf = PdfReader(path)
    text = "\n".join(page.extract_text() for page in pdf.pages)
    assert item["name"] in text and "合成" in text
    rendered = fitz.open(path)
    for n, page in enumerate(rendered):
        page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(PREVIEW / f"{item['key']}-{n+1}.png")
    print(f"Verified {path.name}: {len(pdf.pages)} page(s)")
