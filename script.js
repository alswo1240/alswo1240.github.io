/***********************
 * 사용자 세션
 ***********************/
let currentUser = localStorage.getItem('currentUser');
if (!currentUser) {
    currentUser = 'user_' + Date.now();
    localStorage.setItem('currentUser', currentUser);
}

let currentPopupItem = null;

/***********************
 * DataStore (이식 핵심)
 ***********************/
const DataStore = {
    async load(type) {
        const raw = localStorage.getItem(type);
        const data = raw ? JSON.parse(raw) : [];
        data.forEach(d => d.reviews ??= {});
        return data;
    },
    async save(type, data) {
        localStorage.setItem(type, JSON.stringify(data));
    }
};

/***********************
 * 상태
 ***********************/
let beans = [];
let recipes = [];
let currentAddType = null;
let openFormRef = null;

/***********************
 * 초기 로드
 ***********************/
async function init() {
    beans = await DataStore.load('beans');
    recipes = await DataStore.load('recipes');
    renderAll();
}
init();

/***********************
 * DOM
 ***********************/
const popup = document.getElementById('detail-popup');
const popupContent = document.getElementById('popup-content');
const popupCloseBtn = popup.querySelector('.popup-close');
popup.onclick = e => e.stopPropagation();
popupCloseBtn.onclick = () => popup.classList.add('hidden');
document.addEventListener('click', () => popup.classList.add('hidden'));

/***********************
 * 리스트 렌더링
 ***********************/
function renderList(items, containerId, type) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    items.forEach(itemData => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.id = itemData.id;
        card.dataset.type = type;
        card.innerHTML = `<strong>${itemData.name}</strong>`;

        card.onclick = e => {
            e.stopPropagation();
            openPopup(card, itemData, type);
        };

        container.appendChild(card);
    });
}

// 원두, 레시피 추가
function openAddForm(type) {
    resetUIBeforeNewForm();

    // ⭐ + 버튼 숨김
    setAddButtonVisible(type, false);
    
    // 이미 열려 있으면 다시 열지 않음
    if (openFormRef?.type === 'add' && openFormRef.target === type) return;

    const form = document.createElement('div');
    form.className = 'item-card add-card';

    form.innerHTML = `
        <div class="card-content">
            <input
                type="text"
                class="card-title-input"
                placeholder="${type === 'bean' ? '원두 이름' : '레시피 이름'}"
                id="add-name"
            >
    
            <textarea
                class="card-description-input"
                placeholder="설명"
                id="add-info"
            ></textarea>
    
            <div class="card-actions">
                <button class="primary" id="add-save">저장</button>
                <button class="secondary" id="add-cancel">취소</button>
            </div>
        </div>
    `;


    form.querySelector('#add-save').onclick = () => saveAddForm(type);
    form.querySelector('#add-cancel').onclick = closeOpenForm;

    // 📍 위치 제어 (중요)
    const anchor =
        type === 'bean'
            ? document.getElementById('bean-section')
            : document.getElementById('recipe-section');

    anchor.appendChild(form);

    openFormRef = { type: 'add', target: type, element: form };
}

async function saveAddForm(type) {
    const name = document.getElementById('add-name').value.trim();
    const info = document.getElementById('add-info').value.trim();

    if (!name) return alert('이름을 입력하세요.');

    const newItem = {
        id: Date.now(),
        name,
        info,
        reviews: {}
    };

    const list = type === 'bean' ? beans : recipes;
    list.push(newItem);

    await DataStore.save(type === 'bean' ? 'beans' : 'recipes', list);

    closeOpenForm();
    renderAll();
}


/***********************
 * 팝업
 ***********************/
function openPopup(cardEl, itemData, type) {
    currentPopupItem = { id: itemData.id, type };

    const rect = cardEl.getBoundingClientRect();
    popup.style.top = `${window.scrollY + rect.bottom + 8}px`;
    popup.style.left = `${window.scrollX + rect.left}px`;

    renderPopupContent(itemData, type);
    popup.classList.remove('hidden');
}

function renderPopupContent(itemData, type) {
    const review = itemData.reviews[currentUser];

    popupContent.innerHTML = `
        <p>${itemData.info}</p>
        ${
            review
                ? `<p>내 리뷰: ${'⭐'.repeat(review.rating)}</p>
                   <p>${review.text}</p>
                   <button onclick="openReviewForm(${itemData.id}, '${type}')">리뷰 수정</button>`
                : `<button onclick="openReviewForm(${itemData.id}, '${type}')">리뷰 남기기</button>`
        }
    `;
}

/***********************
 * 리뷰
 ***********************/
function openReviewForm(id, type) {
    closeOpenForm();

    const form = document.createElement('div');
    form.className = 'review-form';
    form.innerHTML = `
        <div class="star-rating">
            ${[1,2,3,4,5].map(n => `<span class="star" data-value="${n}">★</span>`).join('')}
        </div>
        <textarea id="review-text"></textarea>
        <div>
            <button onclick="saveReview(${id}, '${type}')">저장</button>
            <button onclick="closeReviewForm()">취소</button>
        </div>
    `;

    form.querySelectorAll('.star').forEach(star => {
        star.onclick = e => {
            e.stopPropagation();
            const v = +star.dataset.value;
            form.querySelectorAll('.star').forEach(s =>
                s.classList.toggle('active', +s.dataset.value <= v)
            );
        };
    });

    popupContent.appendChild(form);
    openFormRef = { type: 'review', element: form };
}

async function saveReview(id, type) {
    const list = type === 'bean' ? beans : recipes;
    const item = list.find(i => i.id === id);

    const rating = popupContent.querySelectorAll('.star.active').length;
    const text = popupContent.querySelector('#review-text').value.trim();
    if (!rating || !text) return alert('모두 입력');

    item.reviews[currentUser] = { rating, text };
    await DataStore.save(type === 'bean' ? 'beans' : 'recipes', list);

    closeReviewForm();
    renderAll();

    // ⭐ 팝업 즉시 갱신
    const card = document.querySelector(
        `.item-card[data-id="${id}"][data-type="${type}"]`
    );
    if (card) openPopup(card, item, type);
}

function closeReviewForm() {
    const f = popupContent.querySelector('.review-form');
    if (f) f.remove();
}

/***********************
 * 공통
 ***********************/
function closeOpenForm() {
    if (!openFormRef) return;

    if (openFormRef.type === 'add') {
        // ⭐ 다시 + 버튼 표시
        setAddButtonVisible(openFormRef.target, true);
    }
    
    openFormRef.element.remove();
    openFormRef = null;
}

function renderAll() {
    renderList(beans, 'bean-list', 'bean');
    renderList(recipes, 'recipe-list', 'recipe');
}

function resetUIBeforeNewForm() {
    // 1. 리뷰 입력 폼 닫기
    closeReviewForm();

    // 2. 기타 열려 있는 폼 닫기
    closeOpenForm();

    // 3. 팝업 닫기
    popup.classList.add('hidden');

    // 4. 현재 팝업 상태 초기화
    currentPopupItem = null;
}

// 추가 버튼 숨김, 표시 유틸 함수
function setAddButtonVisible(type, visible) {
    const btnId = type === 'bean' ? 'add-bean-btn' : 'add-recipe-btn';
    const btn = document.getElementById(btnId);
    if (!btn) return;

    btn.style.display = visible ? '' : 'none';
}

// 탭 전환 함수
function showTab(tabId) {
    // 모든 탭 숨기기
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.style.display = 'none';
    });

    // 모든 버튼 비활성화
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });

    // 선택한 탭 표시
    const target = document.getElementById(tabId);
    if (target) {
        target.style.display = 'block';
    }

    // 클릭한 버튼 활성화
    const activeBtn = [...document.querySelectorAll('.tab-button')]
        .find(btn => btn.getAttribute('onclick')?.includes(tabId));
    if (activeBtn) activeBtn.classList.add('active');
}
