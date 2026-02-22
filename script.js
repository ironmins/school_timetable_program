let parsedSchedules = [];
let parsedExtensions = {}; 
let parsedBellSchedule = {}; 
let uploadedLogoBase64 = '';

// ==========================================
// 1. 드래그 앤 드롭 통합 헬퍼 함수
// ==========================================
function setupDragAndDrop(dropZoneId, fileInputId, fileCallback) {
    const dropZone = document.getElementById(dropZoneId);
    const fileInput = document.getElementById(fileInputId);
    
    dropZone.addEventListener('click', (e) => {
        if (e.target !== fileInput && e.target.tagName !== 'LABEL') fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) fileCallback(e.target.files[0]);
    });
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => { dropZone.addEventListener(eventName, preventDefaults, false); });
    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover'].forEach(eventName => { dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false); });
    ['dragleave', 'drop'].forEach(eventName => { dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false); });

    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) { fileInput.files = files; fileCallback(files[0]); }
    }, false);
}

// ==========================================
// 2. 파일 파싱 로직 (🔥 컴시간 & 압핀 자동 감지)
// ==========================================
function processExcelFile(file) {
    if (!file) return;
    document.getElementById('upload-status').innerText = '⏳ 분석 중...';

    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, {header: 1}); 
        
        let schedules = [];
        
        // 🔥 양식 자동 감지 로직 (압핀은 '번호', '교사', '시수' 헤더를 가짐)
        let isAppin = false;
        for (let i = 0; i < Math.min(10, json.length); i++) {
            const rowStr = json[i].join('');
            if (rowStr.includes('번호') && rowStr.includes('교사') && rowStr.includes('시수')) {
                isAppin = true;
                break;
            }
        }

        if (isAppin) {
            // ==============================================
            // 📌 압핀 프로그램 양식 파서 (2행 1조 구조)
            // ==============================================
            let dayHeaders = [];
            let periodHeaders = [];
            let dataStartRow = -1;

            // 헤더 찾기
            for (let i = 0; i < Math.min(10, json.length); i++) {
                const row = json[i];
                if (row.includes('월') && (row.includes('화') || row.includes('교사'))) {
                    let currentDay = '';
                    for(let c = 2; c < row.length; c++){ // 압핀은 C열(인덱스 2)부터 교시 시작
                        if(row[c] && typeof row[c] === 'string' && ['월','화','수','목','금'].some(d => row[c].includes(d))) {
                            currentDay = row[c].replace(/[^월화수목금]/g, '');
                        }
                        dayHeaders[c] = currentDay;
                    }
                    periodHeaders = json[i+1];
                    dataStartRow = i + 2;
                    break;
                }
            }

            if (dataStartRow !== -1) {
                for (let i = dataStartRow; i < json.length; i++) {
                    const subjRow = json[i];
                    if (!subjRow || subjRow.length < 2) continue;

                    const teacherName = subjRow[1]; // B열에 교사명
                    if (typeof teacherName === 'string' && teacherName.trim() !== '' && !teacherName.includes('교사')) {
                        const locRow = json[i+1] || []; // 다음 줄은 장소(반) 정보
                        const schedule = { '월': [], '화': [], '수': [], '목': [], '금': [] };

                        for (let c = 2; c < periodHeaders.length; c++) {
                            const day = dayHeaders[c];
                            const period = periodHeaders[c];
                            if (day && period && schedule[day]) {
                                const pIdx = parseInt(period) - 1;
                                const subj = subjRow[c] ? subjRow[c].toString().trim() : '';
                                const loc = locRow[c] ? locRow[c].toString().trim() : '';

                                if (subj || loc) {
                                    // 장소와 과목을 병합하여 렌더러가 인식하기 쉬운 표준 텍스트로 변환
                                    schedule[day][pIdx] = `${loc} ${subj}`.trim();
                                } else {
                                    schedule[day][pIdx] = null;
                                }
                            }
                        }
                        schedules.push({ name: teacherName.trim(), schedule: schedule, maxPeriods: 7, periodCounts: [7, 7, 7, 7, 7] });
                        i++; // 장소 행은 이미 처리했으므로 건너뜀
                    }
                }
            }
        } else {
            // ==============================================
            // 📌 컴시간 프로그램 양식 파서 (1행 1조 구조)
            // ==============================================
            let dayHeaders = [];
            let periodHeaders = [];
            let dataStartRow = -1;
            
            for (let i = 0; i < Math.min(10, json.length); i++) {
                const row = json[i];
                if (row.includes('월') || row.includes('화')) {
                    let currentDay = '';
                    for(let c=1; c<row.length; c++){
                        if(row[c] && typeof row[c] === 'string' && ['월','화','수','목','금'].some(d => row[c].includes(d))) currentDay = row[c].replace(/[^월화수목금]/g, '');
                        dayHeaders[c] = currentDay;
                    }
                }
                if (row.includes(1) && row.includes(2) && row.includes(3)) { periodHeaders = row; dataStartRow = i + 1; break; }
            }
            
            if (dataStartRow !== -1) {
                for (let i = dataStartRow; i < json.length; i++) {
                    const row = json[i];
                    const teacherName = row[0]; 
                    
                    if (!teacherName || typeof teacherName !== 'string' || teacherName.trim() === '' || teacherName.includes('교사명')) continue;
                    const schedule = { '월': [], '화': [], '수': [], '목': [], '금': [] };
                    
                    for (let c = 1; c < periodHeaders.length; c++) {
                        if (dayHeaders[c] && periodHeaders[c] && schedule[dayHeaders[c]]) {
                            schedule[dayHeaders[c]][parseInt(periodHeaders[c]) - 1] = row[c] || null;
                        }
                    }
                    schedules.push({ name: teacherName.trim(), schedule: schedule, maxPeriods: 7, periodCounts: [7, 7, 7, 7, 7] });
                }
            }
        }
        
        parsedSchedules = schedules;
        document.getElementById('upload-status').innerText = `✅ 총 ${schedules.length}명 파싱 완료!`;
        const btn = document.getElementById('generate-btn');
        btn.disabled = false; btn.innerText = `결과 HTML 생성 및 다운로드 🚀`;
    };
    reader.readAsArrayBuffer(file);
}

function processExtFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {header: 1});
        
        parsedExtensions = {}; 
        let count = 0;

        json.forEach(row => {
            if (row[2] && row[4]) {
                let rawName = row[2].toString().replace(/\(.*?\)/g, '').trim(); 
                let extNum = row[4].toString().trim();
                if (rawName && !rawName.includes('성명') && !rawName.includes('과목')) {
                    parsedExtensions[rawName] = extNum;
                    count++;
                }
            }
            if (row[8] && row[10]) {
                let rawName = row[8].toString().replace(/\(.*?\)/g, '').trim(); 
                let extNum = row[10].toString().trim();
                if (rawName && !rawName.includes('성명') && !rawName.includes('과목')) {
                    parsedExtensions[rawName] = extNum;
                    count++;
                }
            }
        });
        document.getElementById('ext-status').innerText = `✅ 총 ${count}명 번호 등록 완료`;
    };
    reader.readAsArrayBuffer(file);
}

function processBellFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {header: 1});
        json.forEach(row => {
            if (row[0] && row[1]) parsedBellSchedule[parseInt(row[0])] = row[1].toString().trim();
        });
        document.getElementById('bell-status').innerText = `✅ 시정표 등록 완료`;
    };
    reader.readAsArrayBuffer(file);
}

function processLogoFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        uploadedLogoBase64 = e.target.result;
        document.getElementById('logo-placeholder').style.display = 'none';
        const preview = document.getElementById('logo-preview');
        preview.src = uploadedLogoBase64; preview.style.display = 'block';
    };
    reader.readAsDataURL(file); 
}

setupDragAndDrop('excel-drop-zone', 'excel-file', processExcelFile);
setupDragAndDrop('ext-drop-zone', 'ext-file', processExtFile);
setupDragAndDrop('bell-drop-zone', 'bell-file', processBellFile);
setupDragAndDrop('logo-drop-zone', 'logo-file', processLogoFile);

// ==========================================
// 3. UI 테마 설정
// ==========================================
const themeColors = {
    'blue': ['#4299E1', '#90CDF4', '#F7FAFC'], 'dark': ['#A0AEC0', '#4A5568', '#1A202C'], 'green': ['#48BB78', '#9AE6B4', '#F0FFF4'],
    'purple': ['#805AD5', '#D6BCFA', '#FAF5FF'], 'orange': ['#ED8936', '#FBD38D', '#FFFAF0'], 'teal': ['#319795', '#81E6D9', '#E6FFFA']
};

document.getElementById('theme-select').addEventListener('change', function() {
    const colors = themeColors[this.value];
    document.getElementById('theme-preview').innerHTML = `
        <span>컬러 팔레트</span>
        <div class="color-chip" style="background-color: ${colors[0]};" title="메인"></div>
        <div class="color-chip" style="background-color: ${colors[1]};" title="보조"></div>
        <div class="color-chip" style="background-color: ${colors[2]}; border: 1px solid #e2e8f0;" title="배경"></div>
    `;
});
document.getElementById('theme-select').dispatchEvent(new Event('change'));

function getThemeCSS(themeName) {
    const themes = {
        'blue': `:root { --primary-color: #4299E1; --primary-light: #90CDF4; --background-color: #EBF8FF; --card-background: #FFFFFF; --text-color: #2D3748; --subtle-text: #718096; --border-color: #E2E8F0; --empty-bg: #F7FAFC; --first-col-bg: #F7FAFC; }`,
        'dark': `:root { --primary-color: #A0AEC0; --primary-light: #CBD5E0; --background-color: #1A202C; --card-background: #2D3748; --text-color: #F7FAFC; --subtle-text: #A0AEC0; --border-color: #4A5568; --empty-bg: #1A202C; --first-col-bg: #2D3748; }`,
        'green': `:root { --primary-color: #48BB78; --primary-light: #9AE6B4; --background-color: #F0FFF4; --card-background: #FFFFFF; --text-color: #22543D; --subtle-text: #4A5568; --border-color: #C6F6D5; --empty-bg: #F7FAFC; --first-col-bg: #F0FFF4; }`,
        'purple': `:root { --primary-color: #805AD5; --primary-light: #D6BCFA; --background-color: #FAF5FF; --card-background: #FFFFFF; --text-color: #1A202C; --subtle-text: #4A5568; --border-color: #E9D8FD; --empty-bg: #F7FAFC; --first-col-bg: #FAF5FF; }`,
        'orange': `:root { --primary-color: #ED8936; --primary-light: #FBD38D; --background-color: #FFFAF0; --card-background: #FFFFFF; --text-color: #7B341E; --subtle-text: #A0AEC0; --border-color: #FEEBC8; --empty-bg: #F7FAFC; --first-col-bg: #FFFAF0; }`,
        'teal': `:root { --primary-color: #319795; --primary-light: #81E6D9; --background-color: #E6FFFA; --card-background: #FFFFFF; --text-color: #234E52; --subtle-text: #4A5568; --border-color: #B2F5EA; --empty-bg: #F7FAFC; --first-col-bg: #E6FFFA; }`
    };
    return themes[themeName] || themes['blue'];
}

// ==========================================
// 4. HTML 생성 로직
// ==========================================
document.getElementById('generate-btn').addEventListener('click', function() {
    const optColor1 = document.getElementById('opt-color1').checked;
    const optColor2 = document.getElementById('opt-color2').checked;
    const optLinebreak = document.getElementById('opt-linebreak').checked;
    const optChip = document.getElementById('opt-chip').checked;
    const pageTitle = document.getElementById('page-title').value;
    const selectedTheme = document.getElementById('theme-select').value;
    const themeCSS = getThemeCSS(selectedTheme);
    const logoHtml = uploadedLogoBase64 ? `<img src="${uploadedLogoBase64}" class="title-icon" alt="학교 로고">` : `📅`;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const generateTimeStr = `${year}-${month}-${day} ${hours}:${mins} (KST)`;

    const htmlTemplate = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle}</title>
    <link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
    <style>
        ${themeCSS}
        * { box-sizing: border-box; }
        body { font-family: 'Pretendard', 'Noto Sans KR', sans-serif; margin: 0; padding: 20px; background-color: var(--background-color); color: var(--text-color); min-height: 100vh; }
        #app-container { max-width: 1100px; margin: 20px auto; background-color: var(--card-background); padding: 40px; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); position: relative;}
        
        h1 { display: flex; align-items: center; justify-content: center; color: var(--text-color); margin-bottom: 5px; text-align: center; font-size: 2em; font-weight: 800; gap: 15px; margin-top: 10px; }
        .title-icon { height: 2.2em; max-width: 150px; object-fit: contain; border-radius: 8px; }
        
        .clock-container { margin: 30px auto 40px auto; background: var(--first-col-bg); padding: 8px 24px; border-radius: 20px; border: 1px solid var(--border-color); font-size: 15px; font-weight: 600; color: var(--text-color); display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); width: fit-content; }
        .clock-icon { font-size: 18px; }

        #search-section { background: var(--empty-bg); padding: 25px; border-radius: 12px; margin-bottom: 30px; }
        .search-container { position: relative; max-width: 500px; margin: 0 auto; }
        #teacher-search { width: 100%; padding: 15px 20px 15px 50px; border: 1px solid var(--border-color); border-radius: 12px; font-size: 16px; font-family: inherit; background-color: var(--card-background); color: var(--text-color); transition: all 0.2s; outline: none; box-sizing: border-box; }
        #teacher-search:focus { border-color: var(--primary-color); box-shadow: 0 0 0 3px var(--primary-light); }
        .search-icon { position: absolute; left: 18px; top: 50%; transform: translateY(-50%); color: var(--subtle-text); font-size: 20px; }
        .autocomplete-dropdown { position: absolute; top: calc(100% + 5px); left: 0; right: 0; background: var(--card-background); border: 1px solid var(--border-color); border-radius: 12px; max-height: 200px; overflow-y: auto; z-index: 1000; display: none; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); }
        .autocomplete-item { padding: 12px 20px; cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s; color: var(--text-color); }
        .autocomplete-item:hover, .autocomplete-item.selected { background-color: var(--primary-light); color: var(--card-background); }
        .favorites-section { margin-top: 20px; text-align: center; }
        .favorites-title { font-size: 14px; color: var(--subtle-text); margin-bottom: 12px; }
        .favorite-chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
        .favorite-chip { background: var(--border-color); color: var(--text-color); padding: 8px 14px; border-radius: 20px; font-size: 14px; cursor: pointer; border: none; font-weight: 500; font-family: inherit; transition: all 0.2s;}
        .favorite-chip:hover { background: var(--primary-color); color: white; transform: translateY(-2px); }
        .search-stats { text-align: center; margin: 15px 0; color: var(--subtle-text); font-size: 14px; }
        
        .ext-badge { background-color: #E2E8F0; color: #1E293B; font-size: 15px; padding: 4px 12px; border-radius: 20px; margin-left: 12px; vertical-align: middle; display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
        
        .schedule-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 10px 0; }
        .teacher-info h2 { margin: 0; font-size: 1.8em; font-weight: 700; color: var(--text-color); display: flex; align-items: center;}
        .teacher-actions { display: flex; gap: 10px; }
        .action-btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border: 1px solid var(--border-color); background: var(--card-background); color: var(--text-color); border-radius: 8px; font-family: inherit; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s; }
        .action-btn:hover { background: var(--primary-light); color: white; }
        .action-btn.favorited { background: #ED8936; border-color: #ED8936; color: white; }
        
        .table-container { overflow-x: auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 20px 0; font-size: 15px; table-layout: fixed; }
        th, td { border-bottom: 1px solid var(--border-color); padding: 18px 10px; text-align: center; vertical-align: middle; word-wrap: break-word; color: var(--text-color); }
        thead th { color: var(--text-color); font-weight: 600; font-size: 14px; background-color: var(--card-background); }
        td:first-child { font-weight: 600; background-color: var(--first-col-bg); }
        
        tbody td { border-right: 1px solid var(--border-color); background-color: var(--card-background); transition: background-color 0.2s; height: 85px; }
        tbody td.clickable-cell { cursor: pointer; position: relative; }
        tbody td.clickable-cell:hover { background-color: var(--empty-bg); box-shadow: inset 0 0 0 2px var(--primary-color); z-index: 10; }
        tbody td.clickable-cell:hover::after { content: "🔄 교체/대체 찾기"; position: absolute; bottom: 5px; right: 5px; font-size: 10px; background: var(--primary-color); color: white; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
        
        tbody td.empty-period { background-color: var(--empty-bg); color: var(--subtle-text); opacity: 0.8; }
        
        .today-header { background-color: var(--primary-color) !important; color: white !important; }
        .today-badge { font-size: 10px; background: white; color: var(--primary-color); padding: 2px 6px; border-radius: 10px; margin-left: 4px; vertical-align: top; font-weight: 800; display: inline-block;}
        .today-cell { border-left: 2px solid var(--primary-color) !important; border-right: 2px solid var(--primary-color) !important; }
        tr:last-child .today-cell { border-bottom: 2px solid var(--primary-color) !important; }

        .subject-tag { display: inline-block; width: 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 50%; color: white; font-weight: 700; font-size: 12px; margin-right: 8px; text-shadow: 0 1px 1px rgba(0,0,0,0.3); }
        .location-chip { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; color: white; margin-right: 6px; margin-bottom: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.2); }
        .empty-state { text-align: center; padding: 80px 20px; }
        .empty-state-icon { font-size: 5em; margin-bottom: 20px; opacity: 0.5; color: var(--primary-color); }
        
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: none; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(4px); }
        .modal-content { background: var(--card-background); width: 90%; max-width: 600px; max-height: 85vh; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); display: flex; flex-direction: column; overflow: hidden; animation: modalIn 0.3s ease-out; }
        @keyframes modalIn { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .modal-header { padding: 20px 25px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--first-col-bg); }
        .modal-header h3 { margin: 0; font-size: 1.2em; color: var(--text-color); display: flex; align-items: center; gap: 8px;}
        .close-btn { background: none; border: none; font-size: 24px; cursor: pointer; color: var(--subtle-text); padding: 0; line-height: 1; transition: color 0.2s; }
        .close-btn:hover { color: var(--primary-color); }
        .modal-body { padding: 25px; overflow-y: auto; background: var(--card-background); }
        
        .result-section { margin-bottom: 25px; }
        .result-section h4 { margin: 0 0 15px 0; color: var(--primary-color); font-size: 1.1em; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--border-color); padding-bottom: 8px; }
        .result-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
        .result-item { background: var(--empty-bg); padding: 12px 15px; border-radius: 8px; border: 1px solid var(--border-color); font-size: 14px; color: var(--text-color); }
        .result-item strong { color: var(--primary-color); font-size: 15px; }
        .result-item span { font-size: 12px; color: var(--subtle-text); display: block; margin-top: 4px; }
        .no-result { color: var(--subtle-text); font-size: 14px; text-align: center; padding: 20px; background: var(--empty-bg); border-radius: 8px; }
        .error-notice { background: #FFF5F5; border-left: 4px solid #FC8181; padding: 15px; margin-bottom: 20px; color: #C53030; font-size: 14px; border-radius: 4px; line-height: 1.5; }

        .footer-credit { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border-color); color: var(--subtle-text); font-size: 13px; line-height: 1.6; }
        .footer-credit p { margin: 0; }

        @media (max-width: 768px) {
            #app-container { padding: 20px; margin-top: 10px; }
            .clock-container { font-size: 13px; margin: 15px auto 25px auto; padding: 6px 16px; }
            th:first-child, td:first-child { position: sticky; left: 0; background: var(--first-col-bg); z-index: 1; }
            .result-list { grid-template-columns: 1fr; }
        }
        @media print {
            body { background: white; }
            #app-container { box-shadow: none; padding: 0; }
            #search-section, .teacher-actions, h1, .clock-container, .footer-credit { display: none; }
            table { font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .today-cell { border: none !important; }
            .today-header { background-color: var(--card-background) !important; color: var(--text-color) !important; }
            .today-badge { display: none; }
            tbody td.clickable-cell::after { display: none; }
        }
    </style>
</head>
<body>
    <div id="app-container">
        <h1>
            ${logoHtml}
            <span>${pageTitle}</span>
        </h1>
        
        <div class="clock-container" id="real-time-clock"></div>
        
        <div id="search-section">
            <div class="search-container">
                <input type="text" id="teacher-search" placeholder="교사 이름을 입력하세요...">
                <div class="autocomplete-dropdown" id="autocomplete-dropdown"></div>
            </div>
            <div class="search-stats" id="search-stats"></div>
            <div class="favorites-section">
                <div class="favorites-title">자주 찾는 교사</div>
                <div class="favorite-chips" id="favorite-chips"></div>
            </div>
        </div>
        <div id="schedule-container">
            <div class="empty-state">
                <div class="empty-state-icon">👨‍🏫</div>
                <h3 style="color: var(--text-color);">시간표를 확인하고 싶은 교사를 검색해보세요</h3>
            </div>
        </div>

        <div class="footer-credit">
            <p>Last updated: ${generateTimeStr}</p>
            <p>Made by IRONMIN (Jeonju high school)</p>
        </div>
    </div>

    <div id="swap-modal" class="modal-overlay" onclick="if(event.target === this) closeSwapModal()">
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="modal-title">🔄 수업 교체 및 보강 찾기</h3>
                <button class="close-btn" onclick="closeSwapModal()">&times;</button>
            </div>
            <div class="modal-body" id="modal-body-content"></div>
        </div>
    </div>
    
    <script>
        const allSchedules = ${JSON.stringify(parsedSchedules)};
        const extNumbers = ${JSON.stringify(parsedExtensions)};
        const bellSchedule = ${JSON.stringify(parsedBellSchedule)};
        
        const isColoringEnabled = ${optColor1};
        const isFormatBColoringEnabled = ${optColor2};
        const isLineBreakEnabled = ${optLinebreak};
        const isLocationChipEnabled = ${optChip};

        const teacherSearchInput = document.getElementById('teacher-search');
        const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
        const scheduleContainer = document.getElementById('schedule-container');
        const searchStats = document.getElementById('search-stats');
        const favoriteChips = document.getElementById('favorite-chips');

        let filteredTeachers = [...allSchedules];
        let selectedIndex = -1;
        let favorites = JSON.parse(localStorage.getItem('favTeachers') || '[]');

        function updateClock() {
            const now = new Date();
            const days = ['일', '월', '화', '수', '목', '금', '토'];
            const dateStr = \`\${now.getFullYear()}.\${String(now.getMonth()+1).padStart(2,'0')}.\${String(now.getDate()).padStart(2,'0')} (\${days[now.getDay()]})\`;
            const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false });
            document.getElementById('real-time-clock').innerHTML = \`<span class="clock-icon">🕒</span> \${dateStr} &nbsp;<b>\${timeStr}</b>\`;
        }
        setInterval(updateClock, 1000);
        updateClock();

        function stringToHslColor(str, s, l) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) { hash = str.charCodeAt(i) + ((hash << 5) - hash); }
            return 'hsl(' + (hash % 360) + ', ' + s + '%, ' + l + '%)';
        }

        function parseCellData(rawCellData) {
            if (!rawCellData) return { location: '', subjectName: '', hasAlphabet: false };
            let str = rawCellData.toString().replace(/_x000D_/g, '').trim();
            let loc = '';
            let subj = str;
            
            const m = str.match(/^(\\S+)\\s+([\\s\\S]+)$/);
            let isLoc = false;
            
            if (m) {
                isLoc = true;
                const firstWord = m[1];
                if (/^[A-Z]$/.test(firstWord)) isLoc = false;
                if (/^[A-Z]_/.test(firstWord)) isLoc = false;
                if (/^[A-Z][가-힣a-zA-Z]+/.test(firstWord)) isLoc = false;
            }
            
            if (m && isLoc) {
                loc = m[1].trim();
                subj = m[2].trim();
            }
            
            const hasAlpha = /[a-zA-Z]/.test(subj);
            return { location: loc, subjectName: subj, hasAlphabet: hasAlpha };
        }

        function isFree(teacherData, day, periodIndex) {
            const cell = teacherData.schedule[day][periodIndex];
            if (!cell || cell === null || cell.trim() === '') return true;
            if (cell.includes('공강')) return true;
            return false;
        }

        function openSwapModal(targetTeacherName, targetDay, targetPeriodIndex) {
            const modal = document.getElementById('swap-modal');
            const bodyContent = document.getElementById('modal-body-content');
            const targetPeriodNum = targetPeriodIndex + 1;
            
            const targetTeacherData = allSchedules.find(t => t.name === targetTeacherName);
            if (!targetTeacherData) return;
            
            let rawCellData = targetTeacherData.schedule[targetDay][targetPeriodIndex] || "";
            document.getElementById('modal-title').innerHTML = \`🔄 <b>\${targetDay}요일 \${targetPeriodNum}교시</b> (\${rawCellData.replace(/_x000D_/g, '').replace(/\\r?\\n/g, ' ')}) 교체/보강 탐색\`;
            
            const targetParsed = parseCellData(rawCellData);
            const targetClass = targetParsed.location;
            const hasAlphabet = targetParsed.hasAlphabet;
            
            let swapResults = [];
            let subResults = [];
            const days = ['월', '화', '수', '목', '금'];

            allSchedules.forEach(otherTeacher => {
                if (otherTeacher.name === targetTeacherName) return;

                if (isFree(otherTeacher, targetDay, targetPeriodIndex)) {
                    subResults.push(otherTeacher.name);
                }

                if (!hasAlphabet && targetClass) {
                    days.forEach(otherDay => {
                        for (let p = 0; p < 7; p++) {
                            if (otherDay === targetDay && p === targetPeriodIndex) continue;

                            let otherCell = otherTeacher.schedule[otherDay][p];
                            if (!otherCell || isFree(otherTeacher, otherDay, p)) continue;
                            
                            const otherParsed = parseCellData(otherCell);
                            const otherClass = otherParsed.location;
                            const otherHasAlphabet = otherParsed.hasAlphabet;
                                
                            if (otherClass === targetClass && !otherHasAlphabet) {
                                if (isFree(otherTeacher, targetDay, targetPeriodIndex) && isFree(targetTeacherData, otherDay, p)) {
                                    swapResults.push({
                                        name: otherTeacher.name,
                                        day: otherDay,
                                        period: p + 1,
                                        subject: otherCell.replace(/_x000D_/g, '').replace(/\\r?\\n/g, ' ')
                                    });
                                }
                            }
                        }
                    });
                }
            });

            let html = '';
            
            if (hasAlphabet) {
                html += \`<div class="error-notice">
                    <b>⚠️ 교체 불가 안내</b><br>
                    선택하신 수업은 알파벳(A, B 등)이 포함된 선택과목/분반 수업입니다.<br>해당 수업은 시스템상 1:1 맞교환(교체)이 불가능하므로, 아래의 <b>대체/보강 가능 교사</b>에게 연락을 부탁드립니다.
                </div>\`;
            } else {
                html += \`<div class="result-section">
                    <h4>🔄 1:1 맞교환 (교체) 가능한 선생님</h4>
                    <p style="font-size:13px; color:var(--subtle-text); margin-top:-10px; margin-bottom:15px;">나의 빈 시간에 동일한 학반(\${targetClass}반) 수업이 있고, 해당 선생님도 나의 수업 시간에 비어있는 경우입니다.</p>\`;
                
                if (swapResults.length > 0) {
                    html += \`<ul class="result-list">\`;
                    swapResults.forEach(res => {
                        const ext = extNumbers[res.name] ? \`📞 \${extNumbers[res.name]}\` : '';
                        html += \`<li class="result-item">
                            <strong>\${res.name}</strong> \${ext}
                            <span>\${res.day}요일 \${res.period}교시 (\${res.subject})</span>
                        </li>\`;
                    });
                    html += \`</ul></div>\`;
                } else {
                    html += \`<div class="no-result">조건에 맞는 교체 가능 교사가 없습니다.</div></div>\`;
                }
            }

            html += \`<div class="result-section">
                <h4>✅ 시간표가 비어있는 (대체/보강) 선생님</h4>
                <p style="font-size:13px; color:var(--subtle-text); margin-top:-10px; margin-bottom:15px;">\${targetDay}요일 \${targetPeriodNum}교시에 수업이 없는(공강) 선생님 목록입니다.</p>\`;
            
            if (subResults.length > 0) {
                html += \`<ul class="result-list">\`;
                subResults.forEach(name => {
                    const ext = extNumbers[name] ? \`📞 \${extNumbers[name]}\` : '';
                    html += \`<li class="result-item" style="padding: 8px 12px;"><strong>\${name}</strong> \${ext}</li>\`;
                });
                html += \`</ul></div>\`;
            } else {
                html += \`<div class="no-result">해당 시간에 공강인 교사가 없습니다.</div></div>\`;
            }

            bodyContent.innerHTML = html;
            modal.style.display = 'flex';
        }

        function closeSwapModal() { document.getElementById('swap-modal').style.display = 'none'; }

        function processSubject(subject) {
            if (!subject) return { html: '', style: '' };
            
            const parsed = parseCellData(subject);
            let location = parsed.location;
            let subjectName = parsed.subjectName;
            let cellBorderStyle = '';
            let processedSubjectName = subjectName;
            let colorApplied = false;

            function applyAlphabetTag(letter, restName) {
                const index = letter.toUpperCase().charCodeAt(0) - 65;
                let color;
                if (index >= 0 && index <= 25) {
                    const letterHue = (index * 137.5) % 360; 
                    const lightness = 45 + (index % 3) * 10;
                    color = \`hsl(\${letterHue}, 80%, \${lightness}%)\`;
                } else {
                    color = stringToHslColor(letter, 60, 55);
                }
                cellBorderStyle = \`border-left: 5px solid \${color};\`;
                const cleanedRestName = restName.replace(/^[\\s\\n_]+/, '');
                return \`<span class="subject-tag" style="background-color: \${color};">\${letter}</span>\` + cleanedRestName;
            }

            if (isColoringEnabled) { 
                const spMatch = subjectName.match(/^([A-Z])[\\s\\n]*_[\\s\\n]*([\\s\\S]+)$/);
                if (spMatch) {
                    processedSubjectName = applyAlphabetTag(spMatch[1], spMatch[2]);
                    colorApplied = true;
                }
            }

            if (isFormatBColoringEnabled && !colorApplied) {
                const formatBMatch = subjectName.match(/^([A-Z])[\\s\\n]*([가-힣a-zA-Z][\\s\\S]*)$/);
                if (formatBMatch) {
                    processedSubjectName = applyAlphabetTag(formatBMatch[1], formatBMatch[2]);
                    colorApplied = true;
                }
            }

            let locationHtml = '';
            if (location) {
                if (isLocationChipEnabled) {
                    let locationColor;
                    const classMatch = location.match(/^([1-3])(\\d{2})$/);
                    if (classMatch) {
                        const grade = parseInt(classMatch[1]);
                        const classNum = parseInt(classMatch[2]);
                        let baseHue;
                        if (grade === 1) baseHue = 210;
                        else if (grade === 2) baseHue = 130;
                        else if (grade === 3) baseHue = 25;
                        const hue = baseHue + (classNum * 4);
                        locationColor = \`hsl(\${hue}, 70%, 55%)\`; 
                    } else {
                        locationColor = stringToHslColor(location, 65, 50);
                    }
                    locationHtml = \`<span class="location-chip" style="background-color: \${locationColor};">\${location}</span>\`;
                } else { 
                    locationHtml = location; 
                }
            }

            let finalHtml = processedSubjectName;
            if (locationHtml) {
                finalHtml = isLineBreakEnabled ? \`\${locationHtml}<br>\${processedSubjectName}\` : \`\${locationHtml} \${processedSubjectName}\`;
            }
            
            finalHtml = finalHtml.replace(/\\r?\\n/g, '<br>');
            return { html: finalHtml, style: cellBorderStyle };
        }

        function init() {
            updateSearchStats(); updateFavoriteChips();
            teacherSearchInput.addEventListener('input', handleSearch);
            teacherSearchInput.addEventListener('keydown', handleKeyNavigation);
            
            document.addEventListener('click', e => { 
                if (!e.target.closest('.search-container')) hideDropdown(); 
                
                const cell = e.target.closest('.clickable-cell');
                if (cell) {
                    const tName = cell.getAttribute('data-teacher');
                    const tDay = cell.getAttribute('data-day');
                    const tPeriod = parseInt(cell.getAttribute('data-period'), 10);
                    openSwapModal(tName, tDay, tPeriod);
                }
            });
        }

        function handleSearch(e) {
            const query = e.target.value.trim().toLowerCase();
            if (query === '') {
                filteredTeachers = [...allSchedules]; hideDropdown();
                scheduleContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👨‍🏫</div><h3 style="color: var(--text-color);">교사를 검색해보세요</h3></div>';
            } else {
                filteredTeachers = allSchedules.filter(t => t.name.toLowerCase().includes(query));
                updateAutocomplete();
            }
            updateSearchStats();
        }

        function handleKeyNavigation(e) {
            const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
            if (!items.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(selectedIndex + 1, items.length - 1); updateSelection(items); }
            if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(selectedIndex - 1, 0); updateSelection(items); }
            if (e.key === 'Enter') { e.preventDefault(); if(selectedIndex >= 0) selectTeacher(filteredTeachers[selectedIndex].name); else if(filteredTeachers.length > 0) selectTeacher(filteredTeachers[0].name); }
        }

        function updateSelection(items) { items.forEach((item, i) => item.classList.toggle('selected', i === selectedIndex)); }
        function updateAutocomplete() {
            if (filteredTeachers.length === 0) return hideDropdown();
            autocompleteDropdown.innerHTML = filteredTeachers.map(t => \`<div class="autocomplete-item" onclick="selectTeacher('\${t.name}')">\${favorites.includes(t.name) ? '⭐ ' : ''}\${t.name}</div>\`).join('');
            autocompleteDropdown.style.display = 'block'; selectedIndex = -1;
        }
        function hideDropdown() { autocompleteDropdown.style.display = 'none'; selectedIndex = -1; }
        function selectTeacher(teacherName) { teacherSearchInput.value = teacherName; hideDropdown(); displaySchedule(teacherName); }

        function displaySchedule(teacherName) {
            const teacher = allSchedules.find(t => t.name === teacherName);
            if (!teacher) return;
            const isFav = favorites.includes(teacherName);
            
            const extNum = extNumbers[teacherName] ? \`<span class="ext-badge">📞 \${extNumbers[teacherName]}</span>\` : '';
            const todayIdx = new Date().getDay() - 1; 

            let tableHTML = \`<div class="schedule-header">
                <div class="teacher-info"><h2>\${teacher.name} 선생님 \${extNum}</h2></div>
                <div class="teacher-actions">
                <button class="action-btn \${isFav ? 'favorited' : ''}" onclick="toggleFavorite('\${teacherName}')"><span>\${isFav ? '⭐ 즐겨찾기됨' : '☆ 즐겨찾기'}</span></button>
                <button class="action-btn" onclick="window.print()"><span>🖨️ 인쇄</span></button></div></div>
                <div class="table-container"><table><thead><tr><th>교시</th>\`;

            ['월', '화', '수', '목', '금'].forEach((day, index) => {
                const isToday = index === todayIdx;
                tableHTML += \`<th class="\${isToday ? 'today-header' : ''}">\${day}\${isToday ? ' <span class="today-badge">오늘</span>' : ''}</th>\`;
            });
            tableHTML += \`</tr></thead><tbody>\`;

            for (let i = 0; i < 7; i++) {
                const periodNum = i + 1;
                const timeStr = bellSchedule[periodNum] ? \`<br><span style="font-size:13.5px; color:var(--subtle-text); font-weight:500; font-family:'Pretendard', sans-serif;">(\${bellSchedule[periodNum]})</span>\` : '';
                
                tableHTML += \`<tr><td>\${periodNum}교시\${timeStr}</td>\`;
                ['월', '화', '수', '목', '금'].forEach((day, index) => {
                    let cellData = teacher.schedule[day] && teacher.schedule[day][i] ? teacher.schedule[day][i].trim() : null;
                    const isToday = index === todayIdx;
                    const cellClass = isToday ? 'today-cell' : ''; 
                    
                    if (cellData && cellData !== '') {
                        const sub = processSubject(cellData);
                        tableHTML += \`<td class="\${cellClass} clickable-cell" style="\${sub.style}" data-teacher="\${teacherName}" data-day="\${day}" data-period="\${i}">\${sub.html}</td>\`;
                    } else {
                        tableHTML += \`<td class="empty-period \${cellClass}"></td>\`; 
                    }
                });
                tableHTML += '</tr>';
            }
            scheduleContainer.innerHTML = tableHTML + '</tbody></table></div>';
        }

        function toggleFavorite(name) {
            const idx = favorites.indexOf(name);
            if (idx > -1) favorites.splice(idx, 1); else favorites.push(name);
            localStorage.setItem('favTeachers', JSON.stringify(favorites));
            updateFavoriteChips(); displaySchedule(name);
        }

        function updateFavoriteChips() {
            favoriteChips.innerHTML = favorites.length === 0 ? '<span style="color:var(--subtle-text);font-size:13px;">즐겨찾기 없음</span>' : favorites.map(name => \`<button class="favorite-chip" onclick="selectTeacher('\${name}')">\${name}</button>\`).join('');
        }

        function updateSearchStats() { searchStats.textContent = teacherSearchInput.value.trim() === '' ? \`총 \${allSchedules.length}명\` : \`\${filteredTeachers.length}명 검색됨\`; }

        init();
    </script>
</body>
</html>`;

    const blob = new Blob([htmlTemplate], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `개인별시간표_업데이트_${new Date().getTime()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url); 
});