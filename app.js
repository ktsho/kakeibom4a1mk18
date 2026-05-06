// ==========================================
// アプリの状態管理とAPI設定
// ==========================================
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDateString = null;
let dbTransactions = []; 

// ★ここをご自身のRenderのURLに書き換えてください！★
const API_BASE_URL = 'https://kakeibo-93mp.onrender.com/api/transactions';
//const FC_API_URL = 'https://kakeibo-93mp.onrender.com/api/fixed_costs';

// ==========================================
// カテゴリ・予算・固定収支設定の管理
// ==========================================
const DEFAULT_SETTINGS = {
    expenseCategories: ["食費", "趣味", "交通費", "服飾", "交際費", "その他"],
    incomeCategories: ["給料", "臨時収入", "その他"],
    defaultExpense: "食費",
    defaultIncome: "給料",
    defaultBudgets: {}, 
    monthlyBudgets: {},
    fixedTemplates: [] // 新設：固定収支のテンプレート
};

let appSettings = JSON.parse(localStorage.getItem('kakeibo_custom_settings')) || DEFAULT_SETTINGS;

if (!appSettings.defaultBudgets) appSettings.defaultBudgets = {};
if (!appSettings.monthlyBudgets) appSettings.monthlyBudgets = {};
if (!appSettings.fixedTemplates) appSettings.fixedTemplates = [];

function saveSettings() {
    localStorage.setItem('kakeibo_custom_settings', JSON.stringify(appSettings));
    renderSettingsView(); 
}

// ==========================================
// メモ欄を使った現金・口座の自動振り分け
// ==========================================
function decodeMemo(rawMemo) {
    if (!rawMemo) return { accountType: 'cash', cleanMemo: '' };
    if (rawMemo.startsWith('[現金] ')) return { accountType: 'cash', cleanMemo: rawMemo.replace('[現金] ', '') };
    if (rawMemo.startsWith('[口座] ')) return { accountType: 'bank', cleanMemo: rawMemo.replace('[口座] ', '') };
    if (rawMemo.startsWith('[現金]')) return { accountType: 'cash', cleanMemo: rawMemo.replace('[現金]', '') };
    if (rawMemo.startsWith('[口座]')) return { accountType: 'bank', cleanMemo: rawMemo.replace('[口座]', '') };
    return { accountType: 'cash', cleanMemo: rawMemo };
}

// ==========================================
// データベース通信 ＆ 固定収支の自動入力処理
// ==========================================

// アプリを開いた時に「今月分」の固定収支を自動で送信する関数
async function applyFixedTransactions() {
    const currentYearNum = new Date().getFullYear();
    const currentMonthNum = new Date().getMonth() + 1;
    const currentMonthKey = `${currentYearNum}-${String(currentMonthNum).padStart(2, '0')}`;
    const lastDayOfMonth = new Date(currentYearNum, currentMonthNum, 0).getDate();
    let appliedAny = false;

    for (let i = 0; i < appSettings.fixedTemplates.length; i++) {
        const template = appSettings.fixedTemplates[i];
        
        // まだ「今月」に入力されていなければ実行
        if (template.lastAppliedMonth !== currentMonthKey) {
            // 月末（2月など）が存在しない日付の場合は、その月の末日に自動調整
            let applyDay = template.day;
            if (applyDay > lastDayOfMonth) applyDay = lastDayOfMonth;
            
            const dateStr = `${currentMonthKey}-${String(applyDay).padStart(2, '0')}`;
            const prefix = template.accountType === 'cash' ? '[現金]' : '[口座]';
            const finalMemo = template.memo ? `${prefix} ${template.memo}` : prefix;

            const payload = {
                date: dateStr,
                category: template.category,
                amount: template.amount,
                memo: finalMemo,
                type: template.type
            };

            try {
                const res = await fetch(API_BASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (res.ok) {
                    template.lastAppliedMonth = currentMonthKey; // 今月分を入力済みにマーク
                    appliedAny = true;
                }
            } catch (e) {
                console.error("固定収支の自動入力に失敗:", e);
            }
        }
    }

    if (appliedAny) saveSettings();
    return appliedAny;
}

async function loadAllData() {
    try {
        const response = await fetch(API_BASE_URL);
        if (response.ok) {
            const rawTxs = await response.json();
            dbTransactions = rawTxs.map(tx => {
                const decoded = decodeMemo(tx.memo);
                return { ...tx, accountType: decoded.accountType, cleanMemo: decoded.cleanMemo };
            });
            renderCalendar(currentYear, currentMonth);
        }
    } catch (error) { 
        console.error("データ取得エラー:", error); 
        alert("データの取得に失敗しました。URLが正しいか確認してください。");
    }
}

// アプリ起動時の初期処理（自動入力してからデータを読み込む）
window.onload = async () => {
    await applyFixedTransactions();
    loadAllData();
};

// ==========================================
// 画面切り替え関数
// ==========================================
function switchView(viewId) {
    document.querySelectorAll('.app-view').forEach(view => view.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    window.scrollTo(0, 0); 
    if (viewId === 'view-settings') renderSettingsView(); 
}

document.querySelectorAll('.btn-back-to-calendar').forEach(btn => btn.addEventListener('click', () => switchView('view-calendar')));
document.getElementById('btn-to-settings').addEventListener('click', () => switchView('view-settings'));

document.getElementById('btn-back-to-detail').addEventListener('click', () => {
    if (selectedDateString === null) { switchView('view-calendar'); } else { openDailyDetail(selectedDateString); }
});

document.getElementById('fab-add').addEventListener('click', () => {
    selectedDateString = null;
    openInputForm(new Date().toISOString().split('T')[0], null); 
});

// ==========================================
// カレンダー＆サマリー描画処理
// ==========================================
function renderCalendar(year, month) {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = ''; 
    document.getElementById('current-month-display').textContent = `${year}年 ${month + 1}月`;

    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();

    let totalIncome = 0; let totalExpense = 0;
    let cashIncome = 0; let cashExpense = 0;
    let bankIncome = 0; let bankExpense = 0;

    let monthIncome = 0; let monthExpense = 0;
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const categoryTotals = {};
    appSettings.expenseCategories.forEach(cat => categoryTotals[cat] = 0);

    dbTransactions.forEach(tx => {
        if (tx.type === 'income') {
            totalIncome += tx.amount;
            if (tx.accountType === 'cash') cashIncome += tx.amount; else bankIncome += tx.amount;
        }
        if (tx.type === 'expense') {
            totalExpense += tx.amount;
            if (tx.accountType === 'cash') cashExpense += tx.amount; else bankExpense += tx.amount;
        }

        if (tx.date.startsWith(monthKey)) {
            if (tx.type === 'income') monthIncome += tx.amount;
            if (tx.type === 'expense') {
                monthExpense += tx.amount;
                if (categoryTotals[tx.category] !== undefined) categoryTotals[tx.category] += tx.amount;
            }
        }
    });

    document.getElementById('total-net-worth').textContent = `${(totalIncome - totalExpense).toLocaleString()}円`;
    document.getElementById('cash-net-worth').textContent = `${(cashIncome - cashExpense).toLocaleString()}円`;
    document.getElementById('bank-net-worth').textContent = `${(bankIncome - bankExpense).toLocaleString()}円`;
    document.getElementById('monthly-income').textContent = `+${monthIncome.toLocaleString()}円`;
    document.getElementById('monthly-expense').textContent = `-${monthExpense.toLocaleString()}円`;

    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-cell empty';
        grid.appendChild(emptyCell);
    }

    for (let i = 1; i <= lastDate; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';
        cell.innerHTML = `<div>${i}</div>`;
        
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayTxs = dbTransactions.filter(tx => tx.date === dateStr);
        let dayIncome = 0; let dayExpense = 0;

        dayTxs.forEach(tx => {
            if (tx.type === 'income') dayIncome += tx.amount;
            if (tx.type === 'expense') dayExpense += tx.amount;
        });

        if (dayExpense > 0) cell.innerHTML += `<div class="expense-mini">-${dayExpense.toLocaleString()}</div>`;
        if (dayIncome > 0) cell.innerHTML += `<div class="income-mini">+${dayIncome.toLocaleString()}</div>`; 
        cell.addEventListener('click', () => openDailyDetail(dateStr));
        grid.appendChild(cell);
    }

    const budgetListContainer = document.getElementById('category-budgets-list');
    budgetListContainer.innerHTML = '';

    appSettings.expenseCategories.forEach(cat => {
        const spent = categoryTotals[cat];
        let budget = 0;
        if (appSettings.monthlyBudgets[monthKey] && appSettings.monthlyBudgets[monthKey][cat] !== undefined) {
            budget = appSettings.monthlyBudgets[monthKey][cat];
        } else if (appSettings.defaultBudgets[cat] !== undefined) {
            budget = appSettings.defaultBudgets[cat];
        }

        const isOver = spent > budget && budget > 0;
        const div = document.createElement('div');
        div.className = 'budget-item';
        div.innerHTML = `<span class="budget-label">${cat}</span><span class="${isOver ? 'over-budget' : ''}">${spent.toLocaleString()}円 / ${budget.toLocaleString()}円</span>`;
        
        div.addEventListener('click', () => {
            const userInput = prompt(`【${cat}】の${month + 1}月の予算を変更します。\n数値を入力してください（単位：円）`, budget);
            if (userInput !== null) {
                const newBudget = parseInt(userInput, 10) || 0;
                if (!appSettings.monthlyBudgets[monthKey]) appSettings.monthlyBudgets[monthKey] = {};
                appSettings.monthlyBudgets[monthKey][cat] = newBudget;
                saveSettings();
                renderCalendar(year, month);
            }
        });
        budgetListContainer.appendChild(div);
    });
}

document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar(currentYear, currentMonth);
});
document.getElementById('next-month').addEventListener('click', () => {
    currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar(currentYear, currentMonth);
});

// ==========================================
// 日別詳細画面
// ==========================================
function openDailyDetail(dateStr) {
    selectedDateString = dateStr;
    const [y, m, d] = dateStr.split('-');
    document.getElementById('detail-date-title').textContent = `${y}年${Number(m)}月${Number(d)}日`;
    const listContainer = document.getElementById('daily-transaction-list');
    listContainer.innerHTML = ''; 

    const dayTxs = dbTransactions.filter(tx => tx.date === dateStr);
    let dayIncome = 0, dayExpense = 0;

    if (dayTxs.length === 0) {
        listContainer.innerHTML = '<p style="font-size: 14px; color: #888; text-align: center;">データがありません</p>';
    } else {
        dayTxs.forEach(tx => {
            if (tx.type === 'income') dayIncome += tx.amount;
            if (tx.type === 'expense') dayExpense += tx.amount;
            const itemDiv = document.createElement('div');
            itemDiv.className = `transaction-item ${tx.type === 'income' ? 'tx-income-item' : 'tx-expense-item'}`;
            const accIcon = tx.accountType === 'cash' ? '💴' : '🏦';
            itemDiv.innerHTML = `<div class="tx-info"><span class="tx-cat">${accIcon} ${tx.category}</span><span class="tx-memo">${tx.cleanMemo || 'メモなし'}</span></div><div class="tx-amount ${tx.type}">${tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString()}円</div>`;
            itemDiv.addEventListener('click', () => openInputForm(dateStr, tx));
            listContainer.appendChild(itemDiv);
        });
    }
    document.getElementById('detail-total-income').textContent = `+${dayIncome.toLocaleString()}円`;
    document.getElementById('detail-total-expense').textContent = `-${dayExpense.toLocaleString()}円`;
    switchView('view-daily-detail');
}

document.getElementById('btn-to-new-input').addEventListener('click', () => { openInputForm(selectedDateString, null); });

// ==========================================
// 入力・編集画面
// ==========================================
function updateCategoryDropdown(selectedType, defaultSelectValue = null) {
    const select = document.getElementById('category');
    select.innerHTML = ''; 
    const categories = selectedType === 'expense' ? appSettings.expenseCategories : appSettings.incomeCategories;
    const defaultCat = selectedType === 'expense' ? appSettings.defaultExpense : appSettings.defaultIncome;

    if (defaultSelectValue && !categories.includes(defaultSelectValue)) {
        const opt = document.createElement('option'); opt.value = defaultSelectValue; opt.textContent = defaultSelectValue; select.appendChild(opt);
    }
    categories.forEach(cat => {
        const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; select.appendChild(opt);
    });
    if (defaultSelectValue) { select.value = defaultSelectValue; } else if (categories.includes(defaultCat)) { select.value = defaultCat; }
}

document.querySelectorAll('input[name="tx-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => { updateCategoryDropdown(e.target.value); });
});

function openInputForm(dateStr, txData) {
    document.getElementById('date').value = dateStr;
    document.getElementById('amount').value = '';
    document.getElementById('memo').value = '';

    if (txData) {
        document.getElementById('input-view-title').textContent = "編集する";
        document.getElementById('edit-id').value = txData.id;
        document.querySelector(`input[name="tx-type"][value="${txData.type}"]`).checked = true;
        document.querySelector(`input[name="account-type"][value="${txData.accountType}"]`).checked = true;
        updateCategoryDropdown(txData.type, txData.category); 
        document.getElementById('amount').value = txData.amount;
        document.getElementById('memo').value = txData.cleanMemo; 
        document.getElementById('delete-btn').style.display = 'block'; 
    } else {
        document.getElementById('input-view-title').textContent = "記帳する";
        document.getElementById('edit-id').value = ""; 
        document.querySelector('input[name="tx-type"][value="expense"]').checked = true;
        document.querySelector('input[name="account-type"][value="cash"]').checked = true;
        updateCategoryDropdown('expense'); 
        document.getElementById('delete-btn').style.display = 'none'; 
    }
    switchView('view-input');
}

document.getElementById('save-btn').addEventListener('click', async () => {
    const editId = document.getElementById('edit-id').value;
    const amount = parseInt(document.getElementById('amount').value, 10);
    const date = document.getElementById('date').value;
    const category = document.getElementById('category').value;
    const cleanMemo = document.getElementById('memo').value;
    const type = document.querySelector('input[name="tx-type"]:checked').value;
    const accountType = document.querySelector('input[name="account-type"]:checked').value;

    if (!amount) { alert("金額を入力してください"); return; }
    const prefix = accountType === 'cash' ? '[現金]' : '[口座]';
    const finalMemo = cleanMemo ? `${prefix} ${cleanMemo}` : prefix;
    const payload = { date, category, amount, memo: finalMemo, type };

    try {
        let url = API_BASE_URL; let method = 'POST';
        if (editId) { url = `${API_BASE_URL}/${editId}`; method = 'PUT'; }
        const response = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.ok) {
            await loadAllData();
            if (selectedDateString) { openDailyDetail(selectedDateString); } else { switchView('view-calendar'); }
        } else { alert("保存に失敗しました。"); }
    } catch (error) { console.error("通信エラー:", error); }
});

document.getElementById('delete-btn').addEventListener('click', async () => {
    if (!confirm("本当にこのデータを削除しますか？")) return;
    const editId = document.getElementById('edit-id').value;
    try {
        const response = await fetch(`${API_BASE_URL}/${editId}`, { method: 'DELETE' });
        if (response.ok) { await loadAllData(); openDailyDetail(selectedDateString); }
    } catch (error) { console.error("通信エラー:", error); }
});

// ==========================================
// 設定画面（固定収支・予算）の制御
// ==========================================

// 固定収支エリアのトグル開閉
document.getElementById('toggle-fixed-settings-btn').addEventListener('click', () => {
    const area = document.getElementById('fixed-settings-area');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
});

// 固定収支のカテゴリ更新
function updateFixedCategoryDropdown(selectedType) {
    const select = document.getElementById('fixed-category');
    select.innerHTML = ''; 
    const categories = selectedType === 'expense' ? appSettings.expenseCategories : appSettings.incomeCategories;
    categories.forEach(cat => {
        const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; select.appendChild(opt);
    });
}
document.querySelectorAll('input[name="fixed-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => { updateFixedCategoryDropdown(e.target.value); });
});

function renderSettingsView() {
    document.getElementById('settings-expense-list').innerHTML = appSettings.expenseCategories.map((cat, index) => {
        const defaultBudget = appSettings.defaultBudgets[cat] || 0;
        return `<div class="category-item" style="flex-wrap: wrap;"><span style="width: 40%; font-weight:bold;">${cat}</span><div style="width: 60%; display:flex; justify-content:flex-end; align-items:center; gap:5px;"><input type="number" value="${defaultBudget}" placeholder="予算(円)" style="width:80px; padding:4px;" onchange="updateDefaultBudget('${cat}', this.value)"><button class="btn-small-del" onclick="deleteCategory('expense', ${index})">削除</button></div></div>`;
    }).join('');

    document.getElementById('settings-income-list').innerHTML = appSettings.incomeCategories.map((cat, index) => `<div class="category-item"><span>${cat}</span><button class="btn-small-del" onclick="deleteCategory('income', ${index})">削除</button></div>`).join('');

    const expSelect = document.getElementById('default-expense-select');
    expSelect.innerHTML = appSettings.expenseCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    if(appSettings.expenseCategories.includes(appSettings.defaultExpense)) expSelect.value = appSettings.defaultExpense;

    const incSelect = document.getElementById('default-income-select');
    incSelect.innerHTML = appSettings.incomeCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    if(appSettings.incomeCategories.includes(appSettings.defaultIncome)) incSelect.value = appSettings.defaultIncome;

    // 固定収支の描画
    const currentFixedType = document.querySelector('input[name="fixed-type"]:checked').value;
    updateFixedCategoryDropdown(currentFixedType);

    const fixedListContainer = document.getElementById('fixed-templates-list');
    fixedListContainer.innerHTML = '';
    if (appSettings.fixedTemplates.length === 0) {
        fixedListContainer.innerHTML = '<p style="text-align:center; font-size:14px; color:#888;">登録されていません</p>';
    } else {
        appSettings.fixedTemplates.forEach((tmp, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = `transaction-item ${tmp.type === 'income' ? 'tx-income-item' : 'tx-expense-item'}`;
            const accIcon = tmp.accountType === 'cash' ? '💴' : '🏦';
            const typeSign = tmp.type === 'income' ? '+' : '-';
            itemDiv.innerHTML = `<div class="tx-info"><span class="tx-cat">毎月 ${tmp.day}日: ${accIcon} ${tmp.category}</span><span class="tx-memo">${tmp.memo || 'メモなし'}</span></div><div style="display: flex; align-items: center;"><div class="tx-amount ${tmp.type}" style="margin-right: 15px;">${typeSign}${tmp.amount.toLocaleString()}円</div><button class="delete-fixed-btn" data-index="${index}" style="background: #ff3b30; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">削除</button></div>`;
            fixedListContainer.appendChild(itemDiv);
        });

        document.querySelectorAll('.delete-fixed-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!confirm("この自動入力を削除しますか？\n（※既にカレンダーに自動入力された過去のデータは消えません）")) return;
                appSettings.fixedTemplates.splice(e.target.getAttribute('data-index'), 1);
                saveSettings();
            });
        });
    }
}

// 固定収支の登録ボタン
document.getElementById('add-fixed-btn').addEventListener('click', async () => {
    const type = document.querySelector('input[name="fixed-type"]:checked').value;
    const accountType = document.querySelector('input[name="fixed-account"]:checked').value;
    const day = parseInt(document.getElementById('fixed-day').value, 10);
    const category = document.getElementById('fixed-category').value;
    const amount = parseInt(document.getElementById('fixed-amount').value, 10);
    const memo = document.getElementById('fixed-memo').value;

    if (!day || day < 1 || day > 31 || !amount) { alert("日付（1〜31）と金額を正しく入力してください"); return; }

    const newTemplate = { id: Date.now(), type, accountType, day, category, amount, memo, lastAppliedMonth: "" };
    appSettings.fixedTemplates.push(newTemplate);
    saveSettings();

    document.getElementById('fixed-amount').value = '';
    document.getElementById('fixed-memo').value = '';

    // 登録後、即座に今月分を自動入力させる
    const applied = await applyFixedTransactions();
    if (applied) await loadAllData();
    alert("固定収支を登録し、今月分のデータをカレンダーに自動入力しました！");
});

window.updateDefaultBudget = function(cat, val) { appSettings.defaultBudgets[cat] = parseInt(val, 10) || 0; saveSettings(); };

document.getElementById('add-expense-cat-btn').addEventListener('click', () => {
    const val = document.getElementById('new-expense-cat-input').value.trim();
    if (val && !appSettings.expenseCategories.includes(val)) { appSettings.expenseCategories.push(val); document.getElementById('new-expense-cat-input').value = ''; saveSettings(); }
});
document.getElementById('add-income-cat-btn').addEventListener('click', () => {
    const val = document.getElementById('new-income-cat-input').value.trim();
    if (val && !appSettings.incomeCategories.includes(val)) { appSettings.incomeCategories.push(val); document.getElementById('new-income-cat-input').value = ''; saveSettings(); }
});
window.deleteCategory = function(type, index) {
    if (!confirm("このカテゴリを削除しますか？\n（※過去の入力データは消えません）")) return;
    if (type === 'expense') {
        const removedCat = appSettings.expenseCategories[index];
        appSettings.expenseCategories.splice(index, 1); delete appSettings.defaultBudgets[removedCat];
        if(!appSettings.expenseCategories.includes(appSettings.defaultExpense)) appSettings.defaultExpense = appSettings.expenseCategories[0] || "";
    } else {
        appSettings.incomeCategories.splice(index, 1);
        if(!appSettings.incomeCategories.includes(appSettings.defaultIncome)) appSettings.defaultIncome = appSettings.incomeCategories[0] || "";
    }
    saveSettings();
};
document.getElementById('default-expense-select').addEventListener('change', (e) => { appSettings.defaultExpense = e.target.value; saveSettings(); });
document.getElementById('default-income-select').addEventListener('change', (e) => { appSettings.defaultIncome = e.target.value; saveSettings(); });