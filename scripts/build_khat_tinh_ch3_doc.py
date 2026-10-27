import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls

def create_chapter_3_docx(output_path):
    doc = docx.Document()

    # --- Page Setup (Book Margins: A4, 2.5cm top/bottom, 2.8cm left/right) ---
    section = doc.sections[0]
    section.page_width = Inches(8.27)   # A4
    section.page_height = Inches(11.69)
    section.top_margin = Inches(1.0)
    section.bottom_margin = Inches(1.0)
    section.left_margin = Inches(1.1)
    section.right_margin = Inches(1.1)

    # --- Header & Footer ---
    header = section.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    hrun = hp.add_run("Khát Tình  |  Chương 03: Phát Tiết")
    hrun.font.name = "Palatino Linotype"
    hrun.font.size = Pt(8.5)
    hrun.font.italic = True
    hrun.font.color.rgb = RGBColor(157, 68, 110) # Dusty Rose

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    frun = fp.add_run("— ❦ —")
    frun.font.name = "Palatino Linotype"
    frun.font.size = Pt(9)
    frun.font.color.rgb = RGBColor(180, 120, 140)

    # --- Color Palette ---
    COLOR_WINE_DEEP   = RGBColor(84, 18, 36)    # #541224 - Deep Burgundy
    COLOR_BURGUNDY    = RGBColor(107, 29, 47)   # #6B1D2F - Rich Bordeaux
    COLOR_ROSE_DUST   = RGBColor(157, 68, 110)  # #9D446E - Dusty Mauve
    COLOR_ROSE_ACCENT = RGBColor(186, 112, 137) # #BA7089 - Soft Rose Gold
    COLOR_BODY_TEXT   = RGBColor(35, 31, 32)    # #231F20 - Soft Charcoal Espresso
    COLOR_FLASHBACK   = RGBColor(85, 30, 48)    # #551E30 - Sensual Plum for Flashback
    
    HEX_BG_BOX        = "FDF7F9" # Ultra-soft pearl rose tint
    HEX_BORDER_ROSE   = "C98CA7" # Rose gold border
    HEX_DEEP_WINE     = "6B1D2F" # Deep wine

    # Set normal style font
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Palatino Linotype'
    normal_style.font.size = Pt(11)
    normal_style.font.color.rgb = COLOR_BODY_TEXT

    # --- Helper Functions ---
    def set_cell_shading(cell, color_hex):
        shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{color_hex}"/>')
        cell._tc.get_or_add_tcPr().append(shading)

    def set_cell_box_border(cell, color_hex, size_eighth_pts=10):
        tcPr = cell._tc.get_or_add_tcPr()
        borders = parse_xml(f'''
            <w:tcBorders {nsdecls("w")}>
                <w:top w:val="single" w:sz="{size_eighth_pts}" w:space="0" w:color="{color_hex}"/>
                <w:left w:val="single" w:sz="{size_eighth_pts}" w:space="0" w:color="{color_hex}"/>
                <w:bottom w:val="single" w:sz="{size_eighth_pts}" w:space="0" w:color="{color_hex}"/>
                <w:right w:val="single" w:sz="{size_eighth_pts}" w:space="0" w:color="{color_hex}"/>
            </w:tcBorders>
        ''')
        tcPr.append(borders)

    def add_ornament_divider(symbol="❦  ✦  ❦"):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after = Pt(14)
        run = p.add_run(f"─── {symbol} ───")
        run.font.name = "Palatino Linotype"
        run.font.size = Pt(11)
        run.font.color.rgb = COLOR_ROSE_ACCENT

    def add_body_paragraph(text, is_first=False, italic=False, color=COLOR_BODY_TEXT):
        p = doc.add_paragraph()
        p.paragraph_format.line_spacing = 1.3
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.space_before = Pt(0)
        
        if is_first:
            p.paragraph_format.first_line_indent = Inches(0)
        else:
            p.paragraph_format.first_line_indent = Inches(0.28)

        run = p.add_run(text)
        run.font.name = "Palatino Linotype"
        run.font.size = Pt(11.5)
        run.font.italic = italic
        run.font.color.rgb = color
        return p

    # ==================== CHAPTER TITLE BLOCK ====================
    p_top = doc.add_paragraph()
    p_top.paragraph_format.space_before = Pt(20)
    p_top.paragraph_format.space_after = Pt(4)
    p_top.alignment = WD_ALIGN_PARAGRAPH.CENTER

    run_series = p_top.add_run("K H Á T   T Ì N H")
    run_series.font.name = "Palatino Linotype"
    run_series.font.size = Pt(10.5)
    run_series.font.bold = True
    run_series.font.color.rgb = COLOR_ROSE_DUST

    p_mini = doc.add_paragraph()
    p_mini.paragraph_format.space_before = Pt(2)
    p_mini.paragraph_format.space_after = Pt(10)
    p_mini.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_mini = p_mini.add_run("· ❦ ·")
    r_mini.font.color.rgb = COLOR_ROSE_ACCENT
    r_mini.font.size = Pt(10)

    p_num = doc.add_paragraph()
    p_num.paragraph_format.space_before = Pt(6)
    p_num.paragraph_format.space_after = Pt(4)
    p_num.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run_num = p_num.add_run("CHƯƠNG 03")
    run_num.font.name = "Palatino Linotype"
    run_num.font.size = Pt(13)
    run_num.font.bold = True
    run_num.font.color.rgb = COLOR_BURGUNDY

    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(2)
    p_title.paragraph_format.space_after = Pt(12)
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run_title = p_title.add_run("PHÁT TIẾT")
    run_title.font.name = "Palatino Linotype"
    run_title.font.size = Pt(24)
    run_title.font.bold = True
    run_title.font.color.rgb = COLOR_WINE_DEEP

    p_div = doc.add_paragraph()
    p_div.paragraph_format.space_before = Pt(0)
    p_div.paragraph_format.space_after = Pt(24)
    p_div.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_div = p_div.add_run("❖  · · · ───────── ❦ ───────── · · ·  ❖")
    r_div.font.name = "Palatino Linotype"
    r_div.font.size = Pt(10)
    r_div.font.color.rgb = COLOR_ROSE_DUST

    # ==================== SCENE 1: HAI CÔ TRỢ LÝ VÀ MÀN BÚ CẶP ĐÔI ====================
    add_body_paragraph(
        "Cánh cửa phòng riêng mở ra. Dương đứng bên khung cửa sổ lớn nhìn xuống bóng đêm thành phố, một tay cầm ly rượu whisky sóng sánh, con cặc trong quần âu vẫn căng cứng đau nhức vì dục vọng bị dồn nén đến tột độ.",
        is_first=True
    )
    add_body_paragraph(
        "Hai người phụ nữ nối gót nhau bước vào phòng."
    )
    add_body_paragraph(
        "Trà đi đầu — cô mặc bộ váy công sở màu be trang nhã và kín đáo, mái tóc buộc cao gọn gàng, gọng kính đen nằm ngay ngắn trên sống mũi thanh tú. Trà đã làm trợ lý bên cạnh Dương suốt ba năm ròng, trung thành đến mức si mê. Cô yêu Dương — không vì tiền bạc hay quyền thế, mà say đắm chính người đàn ông ngang tàng trong anh. Ánh mắt Trà luôn nhìn Dương bằng vẻ dịu dàng tôn sùng, nhưng đêm nay, đáy mắt ấy thoảng nét u buồn vì thừa hiểu mình bước vào đây chỉ với tư cách một công cụ phát tiết."
    )
    add_body_paragraph(
        "My đi ngay phía sau — trái ngược hoàn toàn. Chiếc váy ngắn cũn cỡn màu đỏ rực bó sát từng đường cong nảy lửa, phần cổ khoét sâu hun hút phơi bày hơn nửa bầu ngực trắng nõn. My là mẫu đàn bà thực dụng, lẳng lơ, cam tâm làm trợ lý cho Dương cốt chỉ để thỏa mãn khát khao được quấn lấy đàn ông quyền lực và hưởng thụ khoái lạc xác thịt. My chẳng yêu ai ngoài tiền và những gã đàn ông sung mãn. Đôi môi đỏ mọng khẽ nở nụ cười khêu gợi, ánh mắt cô ta lập tức dán chặt vào khối sưng phồng cứng ngắc cộm lên nơi đũng quần Dương."
    )
    add_body_paragraph(
        "\"Anh gọi bọn em à?\" Trà lên tiếng trước, thanh âm nhẹ nhàng và ngoan ngoãn như mọi khi."
    )
    add_body_paragraph(
        "Dương xoay người lại, đôi mắt vằn lên những tia đỏ rực vì dục hỏa đang sôi trào."
    )
    add_body_paragraph(
        "\"Cởi hết đồ ra. Cả hai đứa.\""
    )
    add_body_paragraph(
        "My cười khẩy một tiếng đầy khoái chí, đôi tay thoăn thoắt vòng ra sau kéo phéc-mơ-tuya váy. \"Em biết ngay mà... Đêm nay anh cần em. Chỗ đó của em đã sẵn sàng ướt đẫm chờ anh rồi đây.\""
    )
    add_body_paragraph(
        "Trà thì chậm hơn, những ngón tay thon dài khẽ run rẩy khi lần mở từng chiếc cúc áo sơ mi. \"Anh Dương... có chuyện gì xảy ra sao anh?\""
    )
    add_body_paragraph(
        "\"Im mồm!\" Dương gầm lên, thẳng tay ném mạnh ly rượu xuống tấm thảm dày, chất lỏng màu hổ phách bắn tung tóe. \"Tối nay anh không muốn nghe bất kỳ đứa nào nói nhiều. Chỉ muốn địt. Hiểu chưa?\""
    )
    add_body_paragraph(
        "Lúc này, My đã trút bỏ hoàn toàn y phục, đứng trần như nhộng. Thân thể cô ả nóng bỏng đến nghẹt thở — hai bầu ngực tròn lẳn như hai quả bưởi chín mọng, vòng eo thon gọn, còn hai bờ đùi thì mở he hé để lộ vùng cấm địa trơn trượt ướt nhẹp dâm thủy."
    )
    add_body_paragraph(
        "\"Em hiểu mà... Đêm nay em sẽ làm con đĩ ngoan cho anh thỏa sức phát tiết.\""
    )
    add_body_paragraph(
        "Trà cũng vừa cởi xong lớp áo váy cuối cùng. Khác với vẻ đẫy đà của My, thân thể Trà mảnh mai và thanh thoát hơn, làn da trắng muốt không tì vết, đôi gò bồng đảo nhỏ nhắn như hai trái đào thơm với hai đầu nhũ hoa hồng hào đang săn cứng vì lạnh và căng thẳng. Cô đứng nép mình, hai tay bối rối che hờ nơi ngực áo, đôi mắt ươn ướt ngấn lệ."
    )
    add_body_paragraph(
        "\"Em... em sẵn sàng rồi...\""
    )
    add_body_paragraph(
        "Dương giật phắt cúc áo sơ mi, để lộ lồng ngực vạm vỡ cùng khối cơ bụng sáu múi rắn rỏi. Hắn kéo khóa quần tây, con cặc thô dài lập tức nảy bật ra ngoài đập mạnh vào bụng dưới — thân cặc đỏ bừng, gân guốc cuồn cuộn nổi rõ mồn một, quy đầu to bè đã rỉ ra giọt dịch nhờn trong suốt."
    )
    add_body_paragraph(
        "\"Trời ơi... to quá...\" My nuốt nước bọt ừng ực, đầu lưỡi đỏ tươi khẽ liếm bờ môi cong cớn."
    )
    add_body_paragraph(
        "\"Quỳ xuống,\" Dương lạnh lùng ra lệnh. \"Cả hai đứa. Bú cặc cho anh.\""
    )
    add_body_paragraph(
        "My không đợi giục lần hai, lập tức quỳ sụp xuống, há rộng miệng ngậm trọn lấy cây cặc khổng lồ vào sâu tận họng. Tiếng mút mát chùn chụt dâm đãng vang lên nghe kích thích đến điên dại. Chiếc lưỡi điêu luyện của My xoay vòng, liếm láp khắp thân cặc gân guốc rồi trượt xuống bìu dái, ngậm chặt từng hòn ngọc hoàn mà mơn trớn."
    )
    add_body_paragraph(
        "\"Ưm... ngon quá... cặc anh vừa to vừa ngon quá...\" My rên rỉ ngắt quãng, miệng vẫn ngậm chặt lấy thân cặc nóng bỏng."
    )
    add_body_paragraph(
        "Trà quỳ xuống chậm hơn, động tác cẩn trọng và dịu dàng hơn hẳn. Cô ghé môi ngậm lấy phần quy đầu đỏ bừng, mút mát êm ái như đang nâng niu que kẹo ngọt, đầu lưỡi khẽ rê vòng quanh vành rãnh quy đầu một cách tỉ mỉ, nâng niu. Trà bú cặc như thể đang thành kính phụng sự vị thần của lòng mình — bởi vì đây là người đàn ông cô yêu say đắm nhất trần đời."
    )
    add_body_paragraph(
        "\"Liếm từ gốc lên đi,\" Dương ấn mạnh bàn tay thô bạo lên đỉnh đầu Trà, ghì mặt cô sát vào háng mình."
    )
    add_body_paragraph(
        "Trà ngoan ngoãn đưa lưỡi liếm dọc theo thân cặc gân guốc, từ tận gốc rễ đi ngược lên đầu khấc, rồi cúi xuống hôn nhẹ lên hai hòn dái săn chắc. Đôi bàn tay mềm mại khẽ vuốt ve phần gốc, nước bọt từ khóe miệng cô trào ra làm cây gậy thịt của Dương trở nên bóng loáng, nhầy nhụa dưới ánh đèn vàng."
    )
    add_body_paragraph(
        "\"Đủ rồi,\" Dương thô bạo rút cặc ra khỏi miệng hai người phụ nữ, lồng ngực phập phồng thở dốc. \"My, nằm ngửa ra ghế sofa. Trà, ngồi lên mặt nó.\""
    )
    add_body_paragraph(
        "My nhếch mép cười đắc ý, lập tức ngả người nằm dài ra chiếc sofa da đen sang trọng, hai chân dạng rộng hết cỡ phơi bày khe bướm hồng hào ướt sũng dâm thủy."
    )
    add_body_paragraph(
        "\"Địt em đi anh... Lồn em nóng ran chảy nước hết rồi đây này...\""
    )
    add_body_paragraph(
        "Trà bước lại gần, hạ thấp thân mình ngồi xổm lên mặt My, ghé sát vùng kín mỏng manh áp vào khuôn miệng đối phương."
    )
    add_body_paragraph(
        "\"Liếm cho chị đi My...\""
    )
    add_body_paragraph(
        "My lập tức thè lưỡi đón nhận, điên cuồng liếm láp, luồn sâu đầu lưỡi ẩm ướt vào giữa hai cánh hoa và kẽ lồn non nớt của Trà."
    )
    add_body_paragraph(
        "Trà ngửa cổ ra sau rên lớn, hai bàn tay bấu chặt vào cặp đùi thon của My để giữ thăng bằng."
    )
    add_body_paragraph(
        "Dương sừng sững bước tới đứng giữa hai chân My, quy đầu to lớn nóng rực dí thẳng vào cửa mình đang mở toang nhớp nháp."
    )
    add_body_paragraph(
        "\"Chuẩn bị đi... Đêm nay anh sẽ địt cho em không còn sức mà thở.\""
    )
    add_body_paragraph(
        "\"Địt em đi... Thúc mạnh vào đi anh...\" My nài nỉ rên xiết."
    )
    add_body_paragraph(
        "Dương gồng hông, thúc mạnh một cú thấu trời — cả thân cặc khổng lồ đâm lút cán vào sâu trong âm đạo chật hẹp."
    )
    add_body_paragraph(
        "Tiếng thét xé toạc căn phòng của My: \"Ahhhh! To quá! Cặc anh to dã man! Địt em đi! Địt mạnh nữa lên anh!\""
    )
    add_body_paragraph(
        "Dương dập như một cỗ máy cuồng bạo, mỗi cú thúc thô bạo đều đâm thẳng đến tận cổ tử cung My. Tiếng thịt va chan chát \"bạch... bạch... bạch...\" vang dội khi đùi anh ta đập liên hồi vào mông cô ả. Hắn địt không chút thương tiếc, như thể đang dồn tất cả nỗi bực tức, ức chế vì bị Yên khước từ vào từng cú nhấp nhả mãnh liệt."
    )
    add_body_paragraph(
        "\"Như thế này hả? Đã sướng chưa?\" Dương gầm gừ trong cuống họng, bàn tay bóp nghiến bầu ngực căng mẩy của My."
    )
    add_body_paragraph(
        "\"Sướng! Sướng muốn chết mất! Địt em đi! Địt nát lồn em đi anh!\""
    )
    add_body_paragraph(
        "My điên cuồng gào thét trong cơn khoái lạc, vách âm đạo co thắt kịch liệt thít chặt lấy thân cặc nóng bỏng của Dương."
    )
    add_body_paragraph(
        "Trà ngồi trên mặt My cũng không ngừng rên rỉ nghẹn ngào. Đầu lưỡi điêu luyện của My liên tục ngoáy sâu vào âm đạo rồi bất ngờ gảy lướt lên hạt le mẫn cảm, khiến Trà run lẩy bẩy, dâm thủy tuôn trào ướt đẫm cằm và mặt My."
    )
    add_body_paragraph(
        "\"Chị Trà... Nước lồn chị ngon và ngọt quá...\" My vừa tranh thủ liếm láp vét sạch vừa lúng búng khen ngợi."
    )
    add_body_paragraph(
        "Dương bất ngờ rút phắt cặc ra khỏi người My khiến cô ả hụt hẫng rên rỉ. Hắn túm lấy eo Trà, nhấc bổng cô xuống rồi ghì ngửa lên tấm thảm lông dày bên dưới sàn."
    )
    add_body_paragraph(
        "\"Đến lượt em. Mở rộng hai chân ra cho anh.\""
    )

    add_ornament_divider("❦  ✦  ❦")

    # ==================== SCENE 2: ĐẦU HÀNG TRONG SẮC DỤC & NỖI ÁM ẢNH VỀ YÊN ====================
    add_body_paragraph(
        "Trà e ấp tách rộng hai đùi, hai bàn tay thẹn thùng che kín khuôn mặt đỏ bừng. Cô không táo bạo, cuồng nhiệt như My, nhưng tình yêu sâu nặng dành cho Dương khiến cô sẵn lòng làm tất cả, dâng hiến trọn vẹn cả linh hồn lẫn thể xác.",
        is_first=True
    )
    add_body_paragraph(
        "Dương căn chỉnh quy đầu, đâm phập một cú dứt khoát vào sâu bên trong. Âm đạo của Trà chật chội hơn, ấm nóng và khít khao hơn hẳn."
    )
    add_body_paragraph(
        "Hắn rên lên một tiếng trầm đục đầy sảng khoái: \"Ưm... Khít quá... Bên trong em thít chặt cặc anh quá Trà ơi...\""
    )
    add_body_paragraph(
        "\"Anh... Anh ơi...\" Trà rên khe khẽ, khóe mắt ngân ngấn giọt lệ hoan lạc vì sung sướng. \"Em yêu anh... Em yêu anh nhiều lắm Dương...\""
    )
    add_body_paragraph(
        "Dương không buông một lời đáp lại. Hắn chỉ điên cuồng thúc hông, mỗi cú dập sâu lút cán đều khiến cơ thể Trà nảy lên theo từng nhịp thở dốc. Hắn gác một chân Trà lên vai mình, đổi góc đâm sâu hơn nữa, để quy đầu thô ráp chạm đến tận cùng nơi sâu kín nhất của tử cung."
    )
    add_body_paragraph(
        "\"Ahh... Sâu quá... Anh ơi... Em ra... Em ra mất...\""
    )
    add_body_paragraph(
        "Trà run rẩy bần bật, toàn thân co thắt dữ dội theo từng đợt sóng cực khoái. Dương nhanh chóng rút cặc ra ngoài, gầm lên một tiếng rồi bắn tinh xối xả lên bụng dưới trắng nõn của Trà — dòng tinh dịch đặc quánh, trắng đục phun trào tung tóe, phủ một mảng nhớp nháp nóng hổi trên làn da mịn màng."
    )
    add_body_paragraph(
        "Thế nhưng ngọn lửa dục vọng trong hắn vẫn chưa hề hạ nhiệt, con cặc vẫn sừng sững cương cứng như sắt nguội."
    )
    add_body_paragraph(
        "\"Vẫn chưa xong đâu,\" Dương thở hổn hển, quay sang túm lấy My. \"Chổng mông lên. Anh chơi lỗ đít em.\""
    )
    add_body_paragraph(
        "My khẽ cười khẩy đầy khiêu khích, lập tức xoay người quỳ gối trên ghế sofa, hai tay bấu chặt vào thành ghế, ưỡn cong lưng và chổng cặp mông tròn trịa lên cao."
    )
    add_body_paragraph(
        "\"Địt đít em đi anh... Lỗ hậu của em đã sẵn sàng phục vụ anh rồi đây...\""
    )
    add_body_paragraph(
        "Dương nhổ một bãi nước bọt vào kẽ mông và cửa hậu nhỏ hẹp của My để bôi trơn, rồi không chút ngần ngại thúc mạnh đầu cặc to lớn xé toạc lớp cơ thắt chen sâu vào bên trong."
    )
    add_body_paragraph(
        "\"Ahhhh! Đau... Nhưng mà sướng phát điên! Thúc mạnh nữa đi anh!\""
    )
    add_body_paragraph(
        "My hét toáng lên, cơ vòng hậu môn thắt chặt lấy từng khúc thịt gân guốc. Dương thúc liên hồi như vũ bão vào cửa sau của cô ả, bàn tay to lớn vung lên giáng những cái tát chan chát vào cặp mông căng tròn đến khi in hằn những vết đỏ ửng."
    )
    add_body_paragraph(
        "Trà nằm nghiêng trên thảm lông, một tay vô thức đưa xuống mơn trớn khe bướm còn đang rỉ nước của chính mình, đôi mắt đờ đẫn nhìn Dương đang cuồng bạo làm tình với My mà đáy lòng cồn cào dục vọng xen lẫn tủi hờn."
    )
    add_body_paragraph(
        "\"Anh... Anh qua đây địt em nữa đi...\" Trà yếu ớt van nài."
    )
    add_body_paragraph(
        "Dương lập tức rút cọc thịt dính đầy dịch nhờn ra khỏi mông My, quay sang đè Trà xuống từ phía sau. Hắn túm lấy lọn tóc dài kéo giật đầu cô ngửa ra sau, cúi xuống cắn ngập răng vào bờ vai mềm mại rồi đâm lút cặc vào âm đạo ẩm ướt."
    )
    add_body_paragraph(
        "\"Ưm... Anh... Em sướng... Em sướng quá anh ơi...\" Trà rên rỉ nghẹn ngào, hoa huyệt co bóp liên hồi như nuốt trọn lấy hắn."
    )
    add_body_paragraph(
        "My nằm bò bên dưới, hai tay vươn tới nắn bóp hai bầu ngực trần của Trà, tay kia luồn xuống tự móc lồn mình."
    )
    add_body_paragraph(
        "Cả căn phòng chìm trong cơn mê loạn của nhục dục — tiếng da thịt va đập bì bồm, tiếng rên xiết đê mê, tiếng thở dốc hổn hển hòa quyện vào nhau tạo nên một bản giao hưởng sắc dục đầy cuồng loạn."
    )
    add_body_paragraph(
        "Địt Trà đến lần thứ ba, Dương mới gầm lên trong cổ họng và bắn toàn bộ lượng tinh dịch còn lại vào tận sâu trong tử cung cô. Luồng tinh nóng rực tràn trề đến mức trào ngược ra cả mép lồn, chảy dài xuống đùi."
    )
    add_body_paragraph(
        "Hắn kiệt sức ngã vật xuống thảm lông, lồng ngực phập phồng thở dốc. Hai người phụ nữ nằm rã rời hai bên, thân thể trần truồng bê bết mồ hôi và tinh dịch nhớp nháp."
    )
    add_body_paragraph(
        "Dương ngửa đầu nhìn chằm chằm lên trần nhà, cây cặc giữa hai chân dần mềm oặt lại. Hắn vừa mây mưa với hai người đàn bà quyến rũ, xuất tinh đến ba lần — nhưng kỳ lạ thay, trong tâm trí hắn lúc này, hình bóng duy nhất ngự trị vẫn là Yên."
    )
    add_body_paragraph(
        "Lồn của Trà hay My dù có khít, có dâm đãng đến mấy cũng không thể nào khỏa lấp được khoảng trống rạo rực trong lòng hắn. Bởi vì hắn biết rõ — người đàn bà duy nhất mà hắn thực sự thèm khát đến phát điên, chính là kẻ vừa lạnh lùng bỏ chạy khỏi hắn lúc nãy."
    )
    add_body_paragraph(
        "\"Mặc đồ rồi ra ngoài hết đi,\" Dương lạnh giọng cất tiếng, mắt không thèm liếc nhìn hai cô gái lấy một lần. \"Tối nay thế là đủ rồi.\""
    )
    add_body_paragraph(
        "Trà gượng ngồi dậy, nét mặt buồn bã khôn nguôi, nơi đáy chậu vẫn còn rỉ ra những giọt tinh dịch trắng đục."
    )
    add_body_paragraph(
        "\"Anh... Anh không sao chứ?\""
    )
    add_body_paragraph(
        "\"Anh bảo ra ngoài!\" Dương gắt lên, thanh âm sắc lạnh như dao."
    )
    add_body_paragraph(
        "My khẽ cười khẩy, bình thản đứng dậy nhặt chiếc váy đỏ mặc lại vào người."
    )
    add_body_paragraph(
        "\"Thôi đi chị Trà. Đầu óc anh ấy đang tơ tưởng đến con đàn bà khác rồi. Bọn mình đêm nay chỉ là đồ chơi thay thế thôi.\""
    )
    add_body_paragraph(
        "Mặt Trà tái mét, cô nhìn Dương với ánh mắt xót xa, đau đớn cùng cực."
    )
    add_body_paragraph(
        "\"Anh... Anh đã yêu người khác thật rồi sao?\""
    )
    add_body_paragraph(
        "Dương không buồn trả lời. Hắn đứng dậy, bước thẳng vào phòng tắm rồi đóng sầm cánh cửa kính lại."
    )
    add_body_paragraph(
        "Trà và My nhìn nhau trong im lặng, rồi lặng lẽ chỉnh đốn quần áo rời khỏi căn phòng."
    )
    add_body_paragraph(
        "Trong phòng tắm, Dương đứng dưới làn nước vòi sen lạnh buốt, dương vật đã mềm nhưng ngọn lửa thèm khát trong tâm trí vẫn bốc cháy ngùn ngụt."
    )
    add_body_paragraph(
        "\"Yên...\" Hắn lẩm bẩm cái tên ấy, nắm đấm giáng mạnh vào bức tường đá hoa cương. \"Em nhất định phải là của anh. Dù có phải ép buộc hay giở mọi thủ đoạn, đêm mai anh cũng sẽ có được em. Địt cho em phải khóc lóc, rên rỉ van xin dưới thân anh mới thôi.\""
    )
    add_body_paragraph(
        "Dòng nước lạnh xối xả chảy dọc theo những múi cơ săn chắc, nhưng chẳng thể nào dập tắt được ngọn lửa khát tình đang thiêu đốt tâm can hắn. Đêm nay hắn đã dùng hai người trợ lý để phát tiết cơn thịnh nộ. Nhưng ngày mai — mục tiêu duy nhất của hắn sẽ là Yên."
    )
    add_body_paragraph(
        "Và khi ấy, hắn sẽ khiến cô không thể nào thoát khỏi móng vuốt của mình."
    )

    # ==================== CHAPTER QUOTE BOX ====================
    table_ill = doc.add_table(rows=1, cols=1)
    table_ill.alignment = WD_TABLE_ALIGNMENT.CENTER
    table_ill.autofit = False
    table_ill.columns[0].width = Inches(5.8)

    cell_ill = table_ill.cell(0, 0)
    set_cell_shading(cell_ill, HEX_BG_BOX)
    set_cell_box_border(cell_ill, HEX_BORDER_ROSE, size_eighth_pts=12)

    # Caption Tag
    cp1 = cell_ill.paragraphs[0]
    cp1.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cp1.paragraph_format.space_before = Pt(10)
    cp1.paragraph_format.space_after = Pt(6)
    r_ill_tag = cp1.add_run("✦  Đ I Ể M   N H Ấ N   C H Ư Ơ N G   3  ✦")
    r_ill_tag.font.name = "Palatino Linotype"
    r_ill_tag.font.size = Pt(9.5)
    r_ill_tag.font.bold = True
    r_ill_tag.font.color.rgb = COLOR_BURGUNDY

    # Caption text
    cp2 = cell_ill.add_paragraph()
    cp2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cp2.paragraph_format.space_before = Pt(4)
    cp2.paragraph_format.space_after = Pt(12)
    cp2.paragraph_format.left_indent = Inches(0.2)
    cp2.paragraph_format.right_indent = Inches(0.2)
    r_ill_text = cp2.add_run("“Sau những cuồng hoan và phát tiết xác thịt tột cùng, thứ duy nhất còn lại găm sâu vào tâm trí kẻ săn mồi... chỉ là cơn khát tình cháy bỏng dành riêng cho người đàn bà vừa khước từ hắn.”")
    r_ill_text.font.name = "Palatino Linotype"
    r_ill_text.font.size = Pt(11)
    r_ill_text.font.italic = True
    r_ill_text.font.bold = True
    r_ill_text.font.color.rgb = COLOR_WINE_DEEP

    # ==================== END BLOCK ====================
    p_end = doc.add_paragraph()
    p_end.paragraph_format.space_before = Pt(24)
    p_end.paragraph_format.space_after = Pt(16)
    p_end.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_end = p_end.add_run("❖   HẾT CHƯƠNG 3   ❖")
    r_end.font.name = "Palatino Linotype"
    r_end.font.size = Pt(12.5)
    r_end.font.bold = True
    r_end.font.color.rgb = COLOR_BURGUNDY

    p_final = doc.add_paragraph()
    p_final.paragraph_format.space_before = Pt(4)
    p_final.paragraph_format.space_after = Pt(10)
    p_final.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_final = p_final.add_run("❦  ❦  ❦")
    r_final.font.color.rgb = COLOR_ROSE_ACCENT
    r_final.font.size = Pt(11)

    doc.save(output_path)
    print(f"Document saved successfully at: {output_path}")

if __name__ == "__main__":
    out_download = r"C:\Users\Kien\Downloads\Khat_Tinh_Chuong_03.docx"
    out_download_template = r"C:\Users\Kien\Downloads\Khat_Tinh_Chuong_03_Template.docx"
    out_scratch = r"C:\Users\Kien\.gemini\antigravity\scratch\truyen\Khat_Tinh_Chuong_03.docx"
    
    create_chapter_3_docx(out_download)
    create_chapter_3_docx(out_download_template)
    create_chapter_3_docx(out_scratch)
