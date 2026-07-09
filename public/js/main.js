document.addEventListener('DOMContentLoaded', () => {
    // 1. XỬ LÝ CHẾ ĐỘ SÁNG / TỐI (DARK / LIGHT MODE)
    const themeToggleBtn = document.getElementById('theme-toggle');
    const currentTheme = localStorage.getItem('theme') || 'dark';

    // Áp dụng theme lưu trữ
    if (currentTheme === 'light') {
        document.body.classList.add('light-mode');
        updateThemeIcon('light');
    } else {
        document.body.classList.remove('light-mode');
        updateThemeIcon('dark');
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            const theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
            localStorage.setItem('theme', theme);
            updateThemeIcon(theme);
        });
    }

    function updateThemeIcon(theme) {
        if (!themeToggleBtn) return;
        if (theme === 'light') {
            themeToggleBtn.innerHTML = '🌙'; // Biểu tượng mặt trăng để quay lại tối
            themeToggleBtn.title = 'Chuyển sang chế độ tối';
        } else {
            themeToggleBtn.innerHTML = '☀️'; // Biểu tượng mặt trời để sang sáng
            themeToggleBtn.title = 'Chuyển sang chế độ sáng';
        }
    }

    // 2. XỬ LÝ TABS BẢNG XẾP HẠNG (RANKINGS TABS)
    const tabs = document.querySelectorAll('.ranking-tab');
    const lists = document.querySelectorAll('.ranking-list');

    if (tabs.length > 0 && lists.length > 0) {
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-tab');

                // Bỏ kích hoạt tất cả các tab và list
                tabs.forEach(t => t.classList.remove('active'));
                lists.forEach(l => l.classList.remove('active'));

                // Kích hoạt tab và list được chọn
                tab.classList.add('active');
                const activeList = document.getElementById(`top-${targetTab}`);
                if (activeList) {
                    activeList.classList.add('active');
                }
            });
        });
    }
});
