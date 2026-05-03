// ==========================================
// アプリの状態管理とAPI設定
// ==========================================
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDateString = null;
let dbTransactions = []; 
let dbFixedCosts = []; // 固定費用のデータ

const API_BASE_URL = 'https://kakeibo-93mp.onrender.com/api/transactions';
const FC_API_URL = 'https://kakeibo-93mp.onrender.com/api/fixed_costs';

// ==========================================
// データベース通信処理
// ==========================================

async function loadAllData() {
    try {
        // 通常の取引データと固定費データの両方を同時に取得
        const [txRes, fcRes] = await Promise.all([
            fetch(API_BASE_URL),
            fetch(FC_API_URL)
        ]);

        if (txRes.ok) dbTransactions = await txRes.json();
        if (fcRes.ok) dbFixedCosts = await fcRes.json();

        renderCalendar(currentYear, currentMonth);
        renderFixedCostsList();
    } catch (error) {
        console.error("データ取得エラー:", error);
    }
}

// ==========================================
// 画面切り替え関数
// ==========================================
function switchView(viewId) {
    document.querySelectorAll('.app-view').forEach(view => view.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    window.scrollTo(0, 0); 
}

document.querySelectorAll('.btn-back-to-calendar').forEach(btn => btn.addEventListener('click', () => switchView('view-calendar')));
document.getElementById('btn-to-settings').addEventListener('click', () => switchView('view-settings'));

document.getElementById('btn-back-to-detail').addEventListener('click', () => {
    if (selectedDateString === null) {
        switchView('view-calendar');
    } else {
        openDailyDetail(selectedDateString);
    }
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

    let monthIncome = 0;
    let monthExpense = 0;

    // 【追加】総資産の計算（すべての期間の収入 - 支出）
    let totalIncome = 0;
    let totalExpense = 0;
    dbTransactions.forEach(tx => {
        if (tx.type === 'income') totalIncome += tx.amount;
        if (tx.type === 'expense') totalExpense += tx.amount;
    });
    const totalAsset = totalIncome - totalExpense;
    document.getElementById('total-net-worth').textContent = `${totalAsset.toLocaleString()}円`;

    // カレンダーの空白埋め
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-cell empty';
        grid.appendChild(emptyCell);
    }

    // カレンダーの日付生成
    for (let i = 1; i <= lastDate; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';
        cell.innerHTML = `<div>${i}</div>`;
        
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayTxs = dbTransactions.filter(tx => tx.date === dateStr);
        
        let dayIncome = 0;
        let dayExpense = 0;

        dayTxs.forEach(tx => {
            if (tx.type === 'income') { dayIncome += tx.amount; monthIncome += tx.amount; }
            if (tx.type === 'expense') { dayExpense += tx.amount; monthExpense += tx.amount; }
        });

        if (dayExpense > 0) cell.innerHTML += `<div class="expense-mini">-${dayExpense.toLocaleString()}</div>`;
        if (dayIncome > 0) cell.innerHTML += `<div class="income-mini">+${dayIncome.toLocaleString()}</div>`; 
        
        cell.addEventListener('click', () => openDailyDetail(dateStr));
        grid.appendChild(cell);
    }

    // 【追加】固定費の合計を計算
    let monthFixedCost = 0;
    dbFixedCosts.forEach(fc => {
        monthFixedCost += fc.amount;
    });

    // 今月のサマリー表示
    document.getElementById('monthly-income').textContent = `+${monthIncome.toLocaleString()}円`;
    document.getElementById('monthly-expense').textContent = `-${monthExpense.toLocaleString()}円`;
    document.getElementById('monthly-fixed').textContent = `-${monthFixedCost.toLocaleString()}円`;
    
    // 今月の残金（収入 - 支出 - 固定費）
    const balance = monthIncome - monthExpense - monthFixedCost;
    document.getElementById('monthly-balance').textContent = `${balance > 0 ? '+' : ''}${balance.toLocaleString()}円`;
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
// 日別詳細・入力画面（変更なし）
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
            itemDiv.innerHTML = `
                <div class="tx-info"><span class="tx-cat">${tx.category}</span><span class="tx-memo">${tx.memo || 'メモなし'}</span></div>
                <div class="tx-amount ${tx.type}">${tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString()}円</div>
            `;
            itemDiv.addEventListener('click', () => openInputForm(dateStr, tx));
            listContainer.appendChild(itemDiv);
        });
    }
    document.getElementById('detail-total-income').textContent = `+${dayIncome.toLocaleString()}円`;
    document.getElementById('detail-total-expense').textContent = `-${dayExpense.toLocaleString()}円`;
    switchView('view-daily-detail');
}

document.getElementById('btn-to-new-input').addEventListener('click', () => {
    openInputForm(selectedDateString, null);
});

function openInputForm(dateStr, txData) {
    document.getElementById('date').value = dateStr;
    document.getElementById('amount').value = '';
    document.getElementById('memo').value = '';
    document.querySelector('input[name="tx-type"][value="expense"]').checked = true;

    if (txData) {
        document.getElementById('input-view-title').textContent = "編集する";
        document.getElementById('edit-id').value = txData.id;
        document.querySelector(`input[name="tx-type"][value="${txData.type}"]`).checked = true;
        document.getElementById('category').value = txData.category;
        document.getElementById('amount').value = txData.amount;
        document.getElementById('memo').value = txData.memo;
        document.getElementById('delete-btn').style.display = 'block'; 
    } else {
        document.getElementById('input-view-title').textContent = "記帳する";
        document.getElementById('edit-id').value = ""; 
        document.getElementById('delete-btn').style.display = 'none'; 
    }
    switchView('view-input');
}

// ==========================================
// 通常データの保存・削除処理
// ==========================================
document.getElementById('save-btn').addEventListener('click', async () => {
    const editId = document.getElementById('edit-id').value;
    const amount = parseInt(document.getElementById('amount').value, 10);
    const date = document.getElementById('date').value;
    const category = document.getElementById('category').value;
    const memo = document.getElementById('memo').value;
    const type = document.querySelector('input[name="tx-type"]:checked').value;

    if (!amount) { alert("金額を入力してください"); return; }

    const payload = { date, category, amount, memo, type };

    try {
        let url = API_BASE_URL;
        let method = 'POST';
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
// 固定費の設定と保存（新規追加）
// ==========================================
function renderFixedCostsList() {
    const listContainer = document.getElementById('fixed-costs-list');
    listContainer.innerHTML = '';

    if (dbFixedCosts.length === 0) {
        listContainer.innerHTML = '<p style="font-size: 14px; color: #888; text-align: center;">登録されていません</p>';
        return;
    }

    dbFixedCosts.forEach(fc => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'transaction-item tx-expense-item';
        itemDiv.innerHTML = `
            <div class="tx-info">
                <span class="tx-cat">毎月 ${fc.payment_day}日</span>
                <span class="tx-memo">${fc.name}</span>
            </div>
            <div style="display: flex; align-items: center;">
                <div class="tx-amount expense" style="margin-right: 15px;">-${fc.amount.toLocaleString()}円</div>
                <button class="delete-fc-btn" data-id="${fc.id}" style="background: #ff3b30; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">削除</button>
            </div>
        `;
        listContainer.appendChild(itemDiv);
    });

    // 削除ボタンのイベント登録
    document.querySelectorAll('.delete-fc-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (!confirm("この固定費を削除しますか？")) return;
            const id = e.target.getAttribute('data-id');
            await fetch(`${FC_API_URL}/${id}`, { method: 'DELETE' });
            loadAllData(); // 再読み込み
        });
    });
}

document.getElementById('save-fc-btn').addEventListener('click', async () => {
    const name = document.getElementById('fc-name').value;
    const amount = parseInt(document.getElementById('fc-amount').value, 10);
    const paymentDay = parseInt(document.getElementById('fc-payment-day').value, 10);

    if (!name || !amount || !paymentDay) { alert("すべての項目を入力してください"); return; }

    const payload = { name, amount, payment_day: paymentDay, memo: "" };

    try {
        const response = await fetch(FC_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            document.getElementById('fc-name').value = '';
            document.getElementById('fc-amount').value = '';
            document.getElementById('fc-payment-day').value = '';
            await loadAllData();
            alert("固定費を登録しました！");
        }
    } catch (error) { console.error("通信エラー:", error); }
});

// アプリ起動時の初期処理
window.onload = () => {
    loadAllData();
};