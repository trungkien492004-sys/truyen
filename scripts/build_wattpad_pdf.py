import os
import sys
import json
import gzip
import urllib.request
import re
import html

sys.stdout.reconfigure(encoding='utf-8')

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, HRFlowable, Table, TableStyle
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# Đăng ký font Times New Roman có sẵn trên Windows hỗ trợ tiếng Việt đầy đủ
pdfmetrics.registerFont(TTFont('Times', r'C:\Windows\Fonts\times.ttf'))
pdfmetrics.registerFont(TTFont('Times-Bold', r'C:\Windows\Fonts\timesbd.ttf'))
pdfmetrics.registerFont(TTFont('Times-Italic', r'C:\Windows\Fonts\timesi.ttf'))
pdfmetrics.registerFont(TTFont('Times-BoldItalic', r'C:\Windows\Fonts\timesbi.ttf'))

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_page_decorations(self, page_count):
        if self._pageNumber > 1:
            self.saveState()
            self.setFont("Times-Italic", 9)
            self.setFillColor(colors.HexColor('#64748b'))
            
            # Header
            self.drawString(54, 800, "Điện Thoại Thần Kỳ Ở Tu Chân Giới — Tuyển tập Wattpad")
            self.setStrokeColor(colors.HexColor('#e2e8f0'))
            self.setLineWidth(0.5)
            self.line(54, 792, 541, 792)

            # Footer
            page_text = f"Trang {self._pageNumber} / {page_count}"
            self.drawRightString(541, 36, page_text)
            self.drawString(54, 36, "Bản trích xuất Wattpad • Tác giả: Niken / Kin Kên")
            self.line(54, 48, 541, 48)

            self.restoreState()

def clean_html_to_paragraphs(raw_html):
    if not raw_html:
        return []
    text = re.sub(r'<br\s*/?>', '\n', raw_html, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    # Loại bỏ các ký tự điều khiển không hợp lệ
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x84\x86-\x9f]', '', text)
    
    paragraphs = []
    for line in text.split('\n'):
        l = line.strip()
        if l:
            # Escape xml characters for ReportLab Paragraph
            l_esc = l.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            paragraphs.append(l_esc)
    return paragraphs

def fetch_wattpad_data():
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    story_url = 'https://www.wattpad.com/api/v3/stories/273327250'
    print("Đang tải danh sách các phần từ Wattpad (story/273327250)...")
    req = urllib.request.Request(story_url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        story_data = json.loads(resp.read().decode('utf-8'))

    parts = story_data.get('parts', [])
    print(f"Tìm thấy {len(parts)} phần trên Wattpad. Bắt đầu tải nội dung chi tiết...")

    parts_full = []
    for idx, p in enumerate(parts):
        pid = p.get('id')
        title = p.get('title') or f"Phần {idx + 1}"
        text_url = f"https://www.wattpad.com/apiv2/storytext?id={pid}"
        req_text = urllib.request.Request(text_url, headers=headers)
        with urllib.request.urlopen(req_text) as r_text:
            raw_bytes = r_text.read()
            try:
                content = gzip.decompress(raw_bytes).decode('utf-8', errors='ignore')
            except Exception:
                content = raw_bytes.decode('utf-8', errors='ignore')

        print(f"  [{idx+1}/{len(parts)}] ID={pid} | Tiêu đề: '{title}' ({len(content)} ký tự)")
        parts_full.append({
            'index': idx + 1,
            'id': pid,
            'title': title,
            'content': content
        })

    return story_data, parts_full

def generate_pdf(story_data, parts_full, output_pdf_path):
    print(f"\nBắt đầu tạo file PDF: {output_pdf_path}...")
    doc = SimpleDocTemplate(
        output_pdf_path,
        pagesize=A4,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()

    # Style Tiêu đề sách
    title_style = ParagraphStyle(
        'BookTitle',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=26,
        leading=32,
        alignment=1, # Center
        textColor=colors.HexColor('#0f172a'),
        spaceAfter=15
    )

    # Style Tác giả
    author_style = ParagraphStyle(
        'BookAuthor',
        parent=styles['Normal'],
        fontName='Times-Italic',
        fontSize=14,
        leading=18,
        alignment=1,
        textColor=colors.HexColor('#475569'),
        spaceAfter=8
    )

    # Style Phụ đề bìa
    subtitle_style = ParagraphStyle(
        'BookSubtitle',
        parent=styles['Normal'],
        fontName='Times',
        fontSize=11,
        leading=15,
        alignment=1,
        textColor=colors.HexColor('#64748b'),
        spaceAfter=25
    )

    # Style Tiêu đề từng phần/chương
    part_heading_style = ParagraphStyle(
        'PartHeading',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=17,
        leading=22,
        textColor=colors.HexColor('#b45309'), # Golden amber
        spaceBefore=14,
        spaceAfter=10,
        keepWithNext=True
    )

    # Style Nội dung đoạn văn
    body_style = ParagraphStyle(
        'BodyVietnamese',
        parent=styles['Normal'],
        fontName='Times',
        fontSize=12,
        leading=17,
        firstLineIndent=20,
        alignment=4, # Justified
        textColor=colors.HexColor('#1e293b'),
        spaceAfter=6
    )

    toc_title_style = ParagraphStyle(
        'TOCTitle',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=16,
        leading=20,
        alignment=1,
        textColor=colors.HexColor('#0f172a'),
        spaceAfter=14
    )

    toc_item_style = ParagraphStyle(
        'TOCItem',
        parent=styles['Normal'],
        fontName='Times',
        fontSize=11,
        leading=16,
        textColor=colors.HexColor('#334155')
    )

    story = []

    # TRANG BÌA
    story.append(Spacer(1, 100))
    story.append(Paragraph("ĐIỆN THOẠI THẦN KỲ Ở TU CHÂN GIỚI", title_style))
    story.append(HRFlowable(width="60%", thickness=1.5, color=colors.HexColor('#d97706'), spaceBefore=5, spaceAfter=15))
    story.append(Paragraph("Tác giả: <b>Niken / Kin Kên</b>", author_style))
    story.append(Paragraph("Nguồn bản thảo: <b>Wattpad (ID: 273327250)</b>", subtitle_style))
    story.append(Paragraph(f"Tuyển tập toàn bộ <b>{len(parts_full)} phần / chương</b> trích xuất và ghép nối theo thứ tự", subtitle_style))
    story.append(Spacer(1, 150))
    story.append(Paragraph("<i>Xuất bản dưới định dạng PDF chuẩn A4, hỗ trợ đầy đủ tiếng Việt có dấu.</i>", subtitle_style))
    story.append(PageBreak())

    # TRANG MỤC LỤC
    story.append(Spacer(1, 20))
    story.append(Paragraph("MỤC LỤC CÁC PHẦN (THEO THỨ TỰ WATTPAD)", toc_title_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#e2e8f0'), spaceBefore=5, spaceAfter=12))

    toc_table_data = []
    for p in parts_full:
        p_name = p['title']
        if p_name.isdigit():
            p_display = f"Chương {p_name}"
        else:
            p_display = p_name
        toc_table_data.append([
            Paragraph(f"<b>Phần {p['index']}:</b>", toc_item_style),
            Paragraph(f"{p_display}", toc_item_style)
        ])

    toc_table = Table(toc_table_data, colWidths=[80, 400])
    toc_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('LINEBELOW', (0,0), (-1,-1), 0.5, colors.HexColor('#f1f5f9')),
    ]))
    story.append(toc_table)
    story.append(PageBreak())

    # NỘI DUNG TỪNG PHẦN
    for p in parts_full:
        p_num = p['index']
        p_title = p['title']
        if p_title.isdigit():
            header_text = f"Phần {p_num}: Chương {p_title}"
        else:
            header_text = f"Phần {p_num}: {p_title}"

        story.append(Paragraph(header_text, part_heading_style))
        story.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor('#f59e0b'), spaceBefore=2, spaceAfter=10))

        paras = clean_html_to_paragraphs(p['content'])
        for para_text in paras:
            story.append(Paragraph(para_text, body_style))

        # Ngắt trang giữa các phần (trừ phần cuối)
        if p_num < len(parts_full):
            story.append(PageBreak())

    # Build PDF với NumberedCanvas (tự tính tổng số trang)
    doc.build(story, canvasmaker=NumberedCanvas)
    size_mb = os.path.getsize(output_pdf_path) / (1024 * 1024)
    print(f"✅ ĐÃ TẠO THÀNH CÔNG FILE PDF: {output_pdf_path} ({size_mb:.2f} MB)")

def main():
    downloads_dir = os.path.expanduser(r'C:\Users\Kien\Downloads')
    output_pdf = os.path.join(downloads_dir, 'Dien_Thoai_Than_Ky_Wattpad_Toan_Tap.pdf')

    story_data, parts_full = fetch_wattpad_data()
    generate_pdf(story_data, parts_full, output_pdf)

if __name__ == '__main__':
    main()
