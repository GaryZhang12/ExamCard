"""Original synthetic catalog; no commercial textbook content."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

out = Path(__file__).parent / 'fixtures'
font_path = r'C:\Windows\Fonts\msyh.ttc'
pdfmetrics.registerFont(TTFont('TocSong', font_path, subfontIndex=0))
entries = [
    {'title':'第一章 基础知识','level':1,'parent':None,'printedPage':'1','pdfPage':1},
    {'title':'第一节 数量关系','level':2,'parent':0,'printedPage':'3','pdfPage':1},
    {'title':'第二节 资料分析','level':2,'parent':0,'printedPage':'8','pdfPage':1},
    {'title':'第二章 综合练习','level':1,'parent':None,'printedPage':'20','pdfPage':2},
    {'title':'第一节 阅读理解','level':2,'parent':3,'printedPage':'22','pdfPage':2},
    {'title':'第二节 错题复盘','level':2,'parent':3,'printedPage':'30','pdfPage':2},
]
text = canvas.Canvas(str(out/'toc-text.pdf'),pagesize=(600,800))
scan = canvas.Canvas(str(out/'toc-scan.pdf'),pagesize=(600,800))
for page in [1,2]:
    img=Image.new('RGB',(1800,2400),'white'); draw=ImageDraw.Draw(img)
    for i,e in enumerate(x for x in entries if x['pdfPage']==page):
        x=60 if e['level']==1 else 90;y=680-i*110
        line=e['title']+'    '+e['printedPage']
        text.setFont('TocSong',22);text.drawString(x,y,line)
        draw.text((x*3,(800-y-22)*3),line,font=ImageFont.truetype(font_path,66),fill='black')
    img.save(out/f'toc-scan-page{page}.png')
    scan.drawImage(ImageReader(img),0,0,width=600,height=800)
    text.showPage();scan.showPage()
text.save();scan.save()
(out/'toc.expected.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf-8')
