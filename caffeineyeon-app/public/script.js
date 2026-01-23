/***********************
 * 서버 이식 버전 (Render 배포용)
 * - localStorage -> 서버(SQLite) + 세션
 ***********************/

// 로그인한 사용자 (서버 세션 기반)
let me = null;              // { name, username, profileImage }
let usersCache = [];        // [{ name, username, profileImage }]

// 게시판 데이터 캐시
let postsCache = [];

/**************************************************** 세션 *************************************************/
async function apiFetch(path, options = {}) {
    const res = await fetch(path, {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    let payload = null;
    try {
        payload = await res.json();
    } catch {
        // ignore
    }

    if (!res.ok) {
        const msg = payload?.message || `요청 실패 (${res.status})`;
        throw new Error(msg);
    }
    return payload;
}

async function refreshMe() {
    const r = await apiFetch('/api/auth/me');
    me = r.user;
    return me;
}

async function refreshUsers() {
    // 로그인 필요
    const r = await apiFetch('/api/users');
    usersCache = r.users || [];
    return usersCache;
}

function getSession() {
    return me ? { username: me.username } : null;
}

function getCurrentUser() {
    return me?.username || null;
}

// DataStore (서버 저장) 
const DataStore = {
    async load(type) {
        const r = await apiFetch(`/api/data/${type}`);
        const data = r.data || [];
        data.forEach(d => d.reviews ??= {});
        return data;
    },
    async save(type, data) {
        await apiFetch(`/api/data/${type}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
};

// 초기 로드
async function init() {
    // 로그인 후에만 호출
    await refreshUsers();

    beans = await DataStore.load('beans') || [];
    recipes = await DataStore.load('recipes') || [];
    postsCache = await DataStore.load('posts') || [];

    renderAll();
    showTab('cdm-tab');
}

/**************************************************** 계정 관련 *************************************************/

let authError;

function showLogin() {
    hideAllAuthForms();
    document.getElementById("login-form").classList.remove("hidden");
}

function showSignup() {
    hideAllAuthForms();
    document.getElementById("signup-form").classList.remove("hidden");
}

function backToSelect() {
    hideAllAuthForms();
    document.getElementById("auth-select").classList.remove("hidden");
    authError.textContent = "";
}

function hideAllAuthForms() {
    document.getElementById("auth-select").classList.add("hidden");
    document.getElementById("login-form").classList.add("hidden");
    document.getElementById("signup-form").classList.add("hidden");
}

async function signup() {

    const name = document.getElementById("signup-name").value.trim();
    const username = document.getElementById("signup-username").value.trim();
    const password = document.getElementById("signup-password").value.trim();
    const confirm_pw = document.getElementById("signup-password-confirm").value.trim();

    if (!name || !username || !password || !confirm_pw) {
        authError.textContent = "모든 항목을 입력하세요.";
        return;
    }

    if (password !== confirm_pw) {
        authError.textContent = "비밀번호가 일치하지 않습니다.";
        return;
    }

    const ok = confirm("회원가입 하시겠습니까?");
    if (!ok) return;

    try {
        await apiFetch('/api/auth/signup', {
            method: 'POST',
            body: JSON.stringify({ name, username, password })
        });

        await refreshMe();
        await init();
        enterAppUI();
    } catch (e) {
        authError.textContent = e.message || '회원가입에 실패했습니다.';
    } 
}

async function login() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!username || !password) {
        authError.textContent = "아이디와 비밀번호를 입력하세요.";
        return;
    }

    try {
        await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        await refreshMe();
        await init();
        enterAppUI();
    } catch (e) {
        authError.textContent = e.message || '로그인에 실패했습니다.';
    }
}

async function logout() {
    const ok = confirm("로그아웃 하시겠습니까?");
    if (!ok) return;

    try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
        // ignore
    }

    me = null;
    usersCache = [];
    postsCache = [];

    // auth 화면 초기화
    resetAuthView();

    // 홈 → 로그인 화면 전환
    document.getElementById("app-root").style.display = "none";
    document.getElementById("auth-root").style.display = "flex";
}

function enterAppUI() {
    document.getElementById("auth-root").style.display = "none";
    document.getElementById("app-root").style.display = "flex";
}

function showAuthUI() {
    document.getElementById("auth-root").style.display = "flex";
    document.getElementById("app-root").style.display = "none";
}

// 로그아웃
document.addEventListener("DOMContentLoaded", () => {
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
    }
});

// 로그인 화면 초기화
function resetAuthView() {
    // 입력값 초기화
    document.querySelectorAll('#auth-root input').forEach(input => {
        input.value = '';
    });

    // 에러 메시지 제거
    const error = document.getElementById('auth-error');
    if (error) error.textContent = '';

    backToSelect();
}

// 로그인 여부에 따라 auth, app 화면 중 보여줄 화면 결정
document.addEventListener("DOMContentLoaded", async () => {
    authError = document.getElementById("auth-error");

    try {
        await refreshMe();
    } catch {
        me = null;
    }

    if (me) {
        await init();
        enterAppUI();
    } else {
        showAuthUI();
        backToSelect();
    }

    document.getElementById('auth-root').style.visibility = 'visible';
    document.getElementById('app-root').style.visibility = 'visible';
});

/**************************************************** CDM tab *************************************************/

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~ 아이템(원두, 레시피) ~~~~~~~~~~~~~~~~~~~~~~~~~~*/

let beans = [];
let recipes = [];
let currentAddType = null;
let openFormRef = null;

// 아이템 리스트 렌더링
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

// 아이템 추가 입력 폼 열기
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

// 아이템 입력 폼 닫기
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

// 아이템 입력 폼 저장
async function saveAddForm(type) {
    const name = document.getElementById('add-name').value.trim();
    const info = document.getElementById('add-info').value.trim();

    if (!name) return alert('이름을 입력하세요.');

    const newItem = {
        id: Date.now(),
        edited: null,
        name,
        info,
        author: getCurrentUser(),
        reviews: {}
    };

    const list = type === 'bean' ? beans : recipes;
    list.push(newItem);

    await DataStore.save(type === 'bean' ? 'beans' : 'recipes', list);

    closeOpenForm();
    renderAll();
}

// 아이템 정보 수정
function openEditItemForm(id, type) {
    const list = type === 'bean' ? beans : recipes;
    const item = list.find(i => i.id === id);
    if (!item) return;

    // 기존 add 폼 재사용
    openAddForm(type);

    const form = openFormRef.element;

    const nameInput = form.querySelector('#add-name');
    const infoInput = form.querySelector('#add-info');
    const saveBtn = form.querySelector('#add-save');

    // ✅ 기존 값 주입
    nameInput.value = item.name;
    infoInput.value = item.info;

    // ✅ 저장 버튼 동작 덮어쓰기 (push ❌)
    saveBtn.onclick = () => {
        const name = nameInput.value.trim();
        const info = infoInput.value.trim();
        if (!name) return;

        item.name = name;
        item.info = info;
        item.edited = Date.now();
        item.author = getCurrentUser();

        if (!confirm("수정한 내용을 저장하시겠습니까?")) return;

        if (type === 'bean') {
            DataStore.save('beans', beans);
        } else {
            DataStore.save('recipes', recipes);
        }
        renderAll();
        openFormRef.type = 'add';
        closeOpenForm();
        
    };
}

// 아이템 삭제
function deleteItem(id, type) {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    if (type === 'bean') {
        beans = beans.filter(b => b.id !== id);
        DataStore.save('beans', beans);
    } else {
        recipes = recipes.filter(r => r.id !== id);
        DataStore.save('recipes', recipes);
    }
    
    popup.classList.add('hidden');
    renderAll();
}

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~ 팝업 ~~~~~~~~~~~~~~~~~~~~~~~~~~*/

let currentPopupItem = null;

const popup = document.getElementById('detail-popup');
const popupContent = document.getElementById('popup-content');
const popupCloseBtn = popup.querySelector('.popup-close');

popup.onclick = e => e.stopPropagation();
popupCloseBtn.onclick = () => popup.classList.add('hidden');
document.addEventListener('click', () => popup.classList.add('hidden'));

// 팝업 열기
function openPopup(cardEl, itemData, type) {
    currentPopupItem = { id: itemData.id, type };

    const rect = cardEl.getBoundingClientRect();
    popup.style.top  = `${window.scrollY + rect.bottom + 8}px`;
    popup.style.left = `${window.scrollX + window.innerWidth / 2}px`;
    popup.style.transform = 'translate(-50%)';

    renderPopupContent(itemData, type);
    popup.classList.remove('hidden');
}

// 팝업 렌더링
function renderPopupContent(itemData, type) {
    const currentUser = getCurrentUser();
    const reviews = itemData.reviews || {};

    let reviewsHtml = '';

    const reviewEntries = Object.entries(reviews);

    if (reviewEntries.length === 0) {
        reviewsHtml = '<p>아직 리뷰가 없습니다.</p>';
    } else {
        reviewEntries.forEach(([username, review]) => {
            reviewsHtml += `
                <div class="review-item">
                    <div class="review-card">
                    <div class="review-header">
                        <div class="review-left">
                            <strong class="selected-user">${getUserNameById(username)}</strong>
                            <span class="review-rating">${'⭐'.repeat(review.rating)}</span>
                        </div>
                        <span class="review-date">${displayDate(review)}</span>
                    </div>
            
                    <p class="review-text preserve-line">${review.text}</p>
                </div>
                    ${
                        username === currentUser
                            ? `
                                <div class="review-actions">
                                    <button onclick="openReviewForm(${itemData.id}, '${type}')">
                                        리뷰 수정
                                    </button>
                                    <button class="danger"
                                        onclick="deleteReview(${itemData.id}, '${type}')">
                                        삭제
                                    </button>
                                </div>
                              `
                            : ''
                    }
                </div>
            `;
        });
    }

    const canWriteReview = currentUser && !reviews[currentUser];
    const isItemAuthor = currentUser && itemData.author === currentUser;

    popupContent.innerHTML = `
        <div class="info-card">
            <h3>${itemData.name}</h3>
            <span class="info-date">${displayDate(itemData)}</span>
            <p class="preserve-line">${itemData.info}</p>
        </div>

        <!-- 🔧 아이템 관리 버튼 -->
        ${
            isItemAuthor
                ? `
                <div class="item-actions">
                    <button onclick="openEditItemForm(${itemData.id}, '${type}')">수정</button>
                    <button onclick="deleteItem(${itemData.id}, '${type}')">삭제</button>
                </div>
                `
                : ''
        }

        <hr>

        <h4>리뷰</h4>
        ${reviewsHtml}

        ${
            canWriteReview
                ? `<button onclick="openReviewForm(${itemData.id}, '${type}')">
                       리뷰 남기기
                   </button>`
                : ''
        }
    `;
}

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~ 리뷰 ~~~~~~~~~~~~~~~~~~~~~~~~~~*/

// 리뷰 입력 폼 열기
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

// 리뷰 입력 폼 닫기
function closeReviewForm() {
    if (!popupContent) return;
    const f = popupContent.querySelector('.review-form');
    if (f) f.remove();
}

// 리뷰 저장
async function saveReview(id, type) {
    const list = type === 'bean' ? beans : recipes;
    const item = list.find(i => i.id === id);

    const rating = popupContent.querySelectorAll('.star.active').length;
    const text = popupContent.querySelector('#review-text').value.trim();
    if (!rating || !text) return alert('별점과 코멘트를 모두 입력하세요.');

    const currentUser = getCurrentUser();
    if (!currentUser) return alert("로그인이 필요합니다.");

    const reviewId = item.reviews && item.reviews[currentUser] ? item.reviews[currentUser].id : Date.now();
    const edited = item.reviews && item.reviews[currentUser] ? Date.now() : null;
    
    item.reviews[currentUser] = { id: reviewId, edited, rating, text }

    await DataStore.save(type === 'bean' ? 'beans' : 'recipes', list);

    closeReviewForm();
    renderAll();

    // ⭐ 팝업 즉시 갱신
    const card = document.querySelector(
        `.item-card[data-id="${id}"][data-type="${type}"]`
    );
    if (card) openPopup(card, item, type);
}

// 리뷰 삭제
function deleteReview(itemId, type) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const items = type === 'bean' ? beans : recipes;
    const item = items.find(i => i.id === itemId);
    if (!item || !item.reviews) return;

    const ok = confirm("리뷰를 삭제하시겠습니까?");
    if (!ok) return;

    // ⭐ 리뷰 삭제
    delete item.reviews[currentUser];

    // 저장
    DataStore.save(type === 'bean' ? 'beans' : 'recipes', items);

    // UI 즉시 반영
    renderAll();
    renderPopupContent(item, type);
}

// 열려있는 입력 폼, 팝업 모두 닫기
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

// 추가 버튼(+) 숨김, 표시 유틸 함수
function setAddButtonVisible(type, visible) {
    const btnId = type === 'bean' ? 'add-bean-btn' : 'add-recipe-btn';
    const btn = document.getElementById(btnId);
    if (!btn) return;

    btn.style.display = visible ? '' : 'none';
}



/**************************************************** MyMenu tab *************************************************/

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~ 프로필 섹션 ~~~~~~~~~~~~~~~~~~~~~~~~~~*/

let selectedUser = getCurrentUser();

// 프로필 새로고침
function initProfile() {
    const user = usersCache.find(u => u.username === selectedUser);
    if (!user) return;

    const imgEl = document.getElementById('profile-image');
    const nameEl = document.getElementById('profile-name');

    nameEl.textContent = user.name;

    if (user.profileImage) {
        imgEl.src = user.profileImage;
    } else {
        imgEl.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="%23eee"/></svg>';
    }
}

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~ 회원 정보 수정 ~~~~~~~~~~~~~~~~~~~~~~~~~~*/

let isEditingProfile = false;

// 프로필 사진 업로드
document.getElementById('profile-upload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
        const dataUrl = reader.result;
        try {
            await apiFetch('/api/auth/me', {
                method: 'PUT',
                body: JSON.stringify({ profileImage: dataUrl })
            });
            await refreshMe();
            await refreshUsers();
            initProfile();
        } catch (err) {
            alert(err?.message || '프로필 사진 변경에 실패했습니다.');
        }
    };

    reader.readAsDataURL(file);
});

// 회원 정보 수정 드롭다운
const toggle = document.getElementById('profile-menu-btn');
const dropdown = document.getElementById('profile-menu-dropdown');

toggle.onclick = () => {
  const currentUser = getCurrentUser();

  // 🔒 본인이 아니면 드롭다운 차단
  if (selectedUser !== currentUser) {
    return;
  }

  dropdown.classList.toggle('hidden');
};

// 회원 정보 수정 모드
function enterProfileEditMode() {
    isEditingProfile = true;

    document.getElementById('profile-upload-btn')
        .classList.remove('hidden');

    document.getElementById('my-reviews-section')
        .style.display = 'none';

    document.getElementById('profile-edit-section')
        .style.display = 'flex';

    fillProfileEditForm();
}

// 세션 정보(사용자 id)로 사용자 객체 찾기
function getCurrentUserObject() {
    return me;
}

// 회원정보 수정 폼
function fillProfileEditForm() {
    const user = getCurrentUserObject();
    if (!user) return;

    document.getElementById('edit-name').value = user.name || '';
    document.getElementById('edit-username').value = user.username || '';

    // 비밀번호는 항상 비워둠
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('new-password-confirm').value = '';

    clearProfileEditError();
}

// 회원 정보 수정 관련 요소
const editName = document.getElementById('edit-name');
const editUsername = document.getElementById('edit-username');
const currentPassword = document.getElementById('current-password');
const newPassword = document.getElementById('new-password');
const newPasswordConfirm = document.getElementById('new-password-confirm');

function showProfileEditError(message) {
    const el = document.getElementById('profile-edit-error');
    if (!el) return;

    el.textContent = message;
    el.style.color = 'red';
}

function clearProfileEditError() {
    const el = document.getElementById('profile-edit-error');
    if (!el) return;

    el.textContent = '';
}

// 회원 정보 수정 저장 버튼
document.getElementById('save-profile-btn').onclick = async () => {
    const ok = confirm('정보를 수정하시겠습니까?');
    if (!ok) return;

    const name = editName.value.trim();
    const username = editUsername.value.trim();

    const currentPw = currentPassword.value;
    const newPw = newPassword.value;
    const newPwConfirm = newPasswordConfirm.value;

    if (!name || !username) {
        showProfileEditError('이름과 아이디는 필수입니다.');
        return;
    }

    if (newPw || newPwConfirm) {
        if (newPw !== newPwConfirm) {
            showProfileEditError('새 비밀번호가 일치하지 않습니다.');
            return;
        }
        if (!currentPw) {
            showProfileEditError('비밀번호를 변경하려면 현재 비밀번호를 입력하세요.');
            return;
        }
    }

    try {
        await apiFetch('/api/auth/me', {
            method: 'PUT',
            body: JSON.stringify({
                name,
                newUsername: username,
                currentPassword: currentPw || null,
                newPassword: newPw || null
            })
        });

        await refreshMe();
        await refreshUsers();

        initProfile();
        renderMyReviews();
        exitProfileEditMode();
    } catch (e) {
        showProfileEditError(e.message || '정보 수정에 실패했습니다.');
    }
};

// 회원 정보 수정 취소 버튼
document.getElementById('cancel-profile-btn').onclick = () => {
    clearProfileEditError();
    exitProfileEditMode();
};

// 회원 정보 수정 모드 나가기
function exitProfileEditMode() {
    isEditingProfile = false;

    document.getElementById('profile-edit-section').style.display = 'none';
    document.getElementById('my-reviews-section').style.display = 'block';

    document.getElementById('profile-upload-btn')
        .classList.add('hidden');
}

// 회원 정보 수정 버튼 클릭 시
document.getElementById('edit-profile-btn').onclick = () => {
    document
        .getElementById('profile-menu-dropdown')
        .classList.add('hidden');

    enterProfileEditMode();
};

toggle.addEventListener('click', e => {
    e.stopPropagation();               // 문서 클릭으로 전파 차단
    //dropdown.classList.toggle('hidden');
});

// 드롭다운 내부 클릭 → 닫힘
dropdown.addEventListener('click', () => {
    dropdown.classList.add('hidden');
});

// 바깥 클릭 → 닫힘
document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
});

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~ 나의 리뷰 섹션 ~~~~~~~~~~~~~~~~~~~~~~~~~~*/

let myReviewType = 'bean';   // 'bean' | 'recipe'
let myReviewSort = 'date';  // 'date' | 'rating'

// 나의 리뷰 수집 (종류별)
function collectMyReviewsByType(type) {
    const source = type === 'bean' ? beans : recipes;
    const results = [];

    source.forEach(item => {
        if (item.reviews && item.reviews[selectedUser]) {
            const review = item.reviews[selectedUser];
            results.push({
                itemName: item.name,
                id: review.id,
                edited: review.edited, 
                rating: review.rating,
                text: review.text
            });
        }
    });

    return results;
}

// 나의 리뷰 렌더링
function renderMyReviews() {
    const grid = document.getElementById('my-reviews-grid');
    if (!grid) return;

    let reviews = collectMyReviewsByType(myReviewType);
    reviews = sortMyReviews(reviews);

    if (reviews.length === 0) {
        grid.innerHTML = '<p class="empty-message">작성한 리뷰가 없습니다.</p>';
        return;
    }

    grid.innerHTML = '';

    reviews.forEach(r => {
        const card = document.createElement('div');
        card.className = 'my-review-card';

        card.innerHTML = `
            <div class="my-review-header">${r.itemName}</div>
            <div class="my-review-date">${displayDate(r)}</div>
            <div class="my-review-star">${'⭐'.repeat(r.rating)}</div>
            <div class="preserve-line">${r.text}</div>
        `;

        grid.appendChild(card);
    });
}

// 리뷰 종류 선택 (원두, 레시피)
function syncReviewTypeButtons() {
    document.querySelectorAll('.review-type-tabs button').forEach(btn => {
        const type = btn.dataset.type; // 'bean' or 'recipe'
        btn.classList.toggle('active', type === myReviewType);
  });
}

document.querySelector('.review-type-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    
    myReviewType = btn.dataset.type;
    console.log(myReviewType);
    syncReviewTypeButtons();
    renderMyReviews();
});

// 리뷰 종류 선택 버튼 활성화
function setActive(activeBtn, selector) {
    document.querySelectorAll(`${selector} button`)
        .forEach(b => b.classList.remove('active'));
    activeBtn.classList.add('active');
}

// 나의 리뷰 정렬 (최신순, 별점순)
function sortMyReviews(reviews) {
    if (myReviewSort === 'rating') {
        return reviews.sort((a, b) => b.rating - a.rating);
    }
    // 최신순
    return reviews.sort((a, b) => b.id - a.id);
}

// 리뷰 정렬 토글
document.querySelectorAll('#sort-menu div').forEach(option => {
    option.addEventListener('click', () => {
        myReviewSort = option.dataset.sort;

        updateSortToggleText(); // ⭐ 추가
        
        document.getElementById('sort-menu').classList.add('hidden');
        renderMyReviews();
    });
});

// 리뷰 정렬 토글 클릭 시 열기(열려 있을 시 닫기)
document.getElementById('sort-toggle').addEventListener('click', e => {
    e.stopPropagation(); // ⭐ 이 줄만 추가
    document.getElementById('sort-menu').classList.toggle('hidden');
});

// 리뷰 정렬 토글 -> 바깥 클릭 시 닫기
document.addEventListener('click', () => {
    document.getElementById('sort-menu').classList.add('hidden');
});

// DOM 완성 직후 토글 텍스트 초기화
document.addEventListener('DOMContentLoaded', () => {
    updateSortToggleText();
});

// 정렬 토글 표시 텍스트 업데이트
function updateSortToggleText() {
    const toggle = document.getElementById('sort-toggle');

    toggle.textContent =
        myReviewSort === 'rating' ? '별점순 ▾' : '최신순 ▾';
}

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~ 다른 사용자의 마이메뉴 조회 ~~~~~~~~~~~~~~~~~~~~~~~~~~*/

popupContent.addEventListener('click', (e) => {
    const userEl = e.target.closest('.selected-user');
    if (!userEl) return;
    
    e.preventDefault();

    selectedUser = getUsernameByName(userEl.textContent);

    showTab('mymenu-tab', true);
});

/**************************************************** Board tab *************************************************/

let currentPage = 'detail';
let editorMode = 'add';      // 'add' | 'edit'
let editingPostId = null;
let currentPostId = null;

let editorTitle;
let editorContent;

function loadPosts() {
    return postsCache || [];
}

function savePosts(posts) {
    postsCache = posts;
    // 서버에 저장 (비동기: UI는 즉시 반영)
    DataStore.save('posts', postsCache).catch(() => {});
}

function getPostById(id) {
    return loadPosts().find(p => p.id === id);
}

// 게시판 페이지 초기화
function resetBoardView() {
    // 내부 상태 초기화
    editorMode = 'add';
    editingPostId = null;
    currentPostId = null;

    // 목록 화면만 표시
    document.getElementById('board-list-view').classList.remove('hidden');
    document.getElementById('board-detail-view').classList.add('hidden');
    document.getElementById('board-editor-view').classList.add('hidden');

    renderPostList();
}

// 게시글 리스트 렌더링
function renderPostList() {
    const list = document.getElementById('post-list');
    let posts = loadPosts();
    
    posts = sortPosts(posts);

    if (boardCategoryFilter !== 'all') {
        posts = posts.filter(
            p => p.category === boardCategoryFilter
        );
    }

    if (posts.length === 0) {
        list.innerHTML = '<p class="empty-message">게시글이 없습니다.</p>';
        return;
    }

    list.innerHTML = '';

    posts.forEach(post => {
        const div = document.createElement('div');
        div.className = 'post-item';

        div.onclick = () => {
            openPostDetail(post.id);
        };

        div.innerHTML = `
            <div class="post-category">${getCategoryLabel(post.category)}</div>
            <h3>${post.title}</h3>
            <p class="post-meta">${getUserNameById(post.author)} · ${displayDate(post)}</p>
        `;

        list.appendChild(div);
    });
}

// 게시글 상세 페이지
function openPostDetail(postId) {
    const post = getPostById(postId);
    if (!post) return;

    currentPostId = postId;
    showBoardView('detail');

    const container = document.getElementById('post-container');
    const imagesHTML = post.images?.length
        ? post.images.map(img => `<img src="${img}" class="post-image">`).join('')
        : '';
    
    container.innerHTML = `
        <div class="post-category">${getCategoryLabel(post.category)}</div>
        <h2 class="post-title">${post.title}</h2>
        <p class="post-meta">${getUserNameById(post.author)} · ${displayDate(post)}</p>
        <div class="post-images">${imagesHTML}</div>
        <div class="post-content preserve-line">${post.content}</div>
    `;

    const isAuthor = getCurrentUser() === post.author;

    document.getElementById('edit-post-btn').style.display =
        isAuthor ? 'inline-block' : 'none';
    document.getElementById('delete-post-btn').style.display =
        isAuthor ? 'inline-block' : 'none';
}

// 게시글 목록 화면으로 복귀
window.addEventListener('popstate', e => {
    if (!e.state || e.state.view !== 'post') {
        // 목록 화면으로 복귀
        currentPage='list';
        showBoardView(currentPage);
        renderPostList();
    }
});

// 게시글 상세 화면 로드
document.addEventListener('DOMContentLoaded', () => {
    if (location.hash.startsWith('#post-')) {
        const postId = Number(location.hash.replace('#post-', ''));
        openPostDetail(postId);
    }
});

// 게시판 탭 내 페이지 설정 (목록, 상세, 입력)
function showBoardView(view) {
    currentPage = view;
    ['list', 'detail', 'editor'].forEach(v => {
        document
            .getElementById(`board-${v}-view`)
            .classList.add('hidden');
    });

    document
        .getElementById(`board-${view}-view`)
        .classList.remove('hidden');
}

// 게시글 추가 버튼
document.getElementById('add-post-btn').onclick = () => {
    openPostEditor();
};

// 게시글 수정 시 기존 내용 채워 넣기
document.addEventListener('DOMContentLoaded', () => {
    editorTitle = document.getElementById('editor-title');
    editorContent = document.getElementById('editor-content');
});

// 게시판 탭 내 페이지 뒤로가기
function goBack() {
    if (currentPage === 'editor' && editorMode === 'edit') {
        currentPage = 'detail';
        openPostDetail(editingPostId);
    } else {
        currentPage = 'list';
        showBoardView(currentPage);
    }
}

// 게시글 에디터 열기
function openPostEditor(post = null) {
    currentPage = 'editor';
    showBoardView(currentPage);

    editorImages = [];
    document.getElementById('editor-image-preview').innerHTML = '';
    document.getElementById('editor-image').value = '';
    
    if (post) {
        editorMode = 'edit';
        editingPostId = post.id;

        editorTitle.value = post.title;
        editorContent.value = post.content;
        selectedPostCategory = post.category;
        
        if (post.images?.length) {
            editorImages = [...post.images];
            renderEditorImages();
        }
        
    } else {
        editorMode = 'add';
        editingPostId = null;

        editorTitle.value = '';
        editorContent.value = '';
        selectedPostCategory = 'free';
    }
    
    document.querySelectorAll('.editor-category button').forEach(btn => {
        btn.classList.toggle(
            'active',
            btn.dataset.category === selectedPostCategory
        );
    });
}

// 게시글 수정 버튼
document.getElementById('edit-post-btn').onclick = () => {
    const post = getPostById(currentPostId);
    openPostEditor(post);
};

// 게시글 삭제
function deletePost(id) {
    if (!confirm('게시글을 삭제할까요?')) return;

    const posts = loadPosts().filter(p => p.id !== id);
    savePosts(posts);

    renderPostList();
    showBoardView('list');
}

// 게시글 삭제 버튼
document.getElementById('delete-post-btn').onclick = () => {
    const post = getPostById(currentPostId);
    deletePost(post.id);
};

// 게시글 저장 버튼
document.getElementById('save-post-btn').onclick = () => {
    const title = editorTitle.value.trim();
    const content = editorContent.value.trim();

    if (!title || !content) {
        alert('제목과 내용을 입력하세요.');
        return;
    }

    const posts = loadPosts();

    if (editorMode === 'add') {
        const postId = Date.now();
        currentPostId = postId;
        posts.push({
            id: postId,
            edited: null,
            title,
            content,
            images: editorImages,
            category: selectedPostCategory,
            author: getCurrentUser()
        });
    } else {
        const post = posts.find(p => p.id === editingPostId);
        post.edited = Date.now();
        post.title = title;
        post.content = content;
        post.images = editorImages;
        post.category = selectedPostCategory;
    }

    savePosts(posts);
    renderPostList();
    currentPage = 'detail';
    openPostDetail(currentPostId);
};

let boardSort = 'latest'; // 'latest' | 'oldest'

// 게시글 정렬
function sortPosts(posts) {
    if (boardSort === 'oldest') {
        return posts.sort((a, b) => a.id - b.id);
    }
    // 최신순 (기본)
    return posts.sort((a, b) => b.id - a.id);
}

const boardSortToggle = document.getElementById('board-sort-toggle');
const boardSortMenu = document.getElementById('board-sort-menu');

// 게시글 정렬 토글
document.querySelectorAll('#board-sort-menu div').forEach(opt => {
    opt.onclick = () => {
        boardSort = opt.dataset.sort;
        boardSortToggle.textContent =
            boardSort === 'latest' ? '최신순 ▾' : '오래된순 ▾';

        boardSortMenu.classList.add('hidden');
        renderPostList();
    };
});

// 게시글 정렬 토글 클릭 시 열기 (열려 있으면 닫기)
boardSortToggle.onclick = (e) => {
    e.stopPropagation();
    boardSortMenu.classList.toggle('hidden');
};

// 게시글 정렬 토글 -> 바깥 클릭 시 닫기
document.addEventListener('click', () => {
    boardSortMenu.classList.add('hidden');
});

// 게시글 카테고리 기본값
let selectedPostCategory = 'free';

// 게시글 카테고리
function getCategoryLabel(category) {
    return {
        notice: '공지',
        suggestion: '건의',
        ledger: '장부',
        free: '자유'
    }[category] || '';
}

// 에디터 내 게시글 카테고리 선택 버튼
document.querySelectorAll('.editor-category button').forEach(btn => {
    btn.onclick = () => {
        selectedPostCategory = btn.dataset.category;

        document
            .querySelectorAll('.editor-category button')
            .forEach(b => b.classList.remove('active'));

        btn.classList.add('active');
    };
});

let boardCategoryFilter = 'all';

// 게시글 목록 보기에서 카테고리 선택
document
    .querySelectorAll('.board-category-filter button')
    .forEach(btn => {
        btn.onclick = () => {
            boardCategoryFilter = btn.dataset.category;

            document
                .querySelectorAll('.board-category-filter button')
                .forEach(b => b.classList.remove('active'));

            btn.classList.add('active');
            renderPostList();
        };
    });

let editorImageData = null;

// 이미지 업로드
document.getElementById('editor-image').addEventListener('change', e => {
    const files = Array.from(e.target.files);

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = () => {
            editorImages.push(reader.result);
            renderEditorImages();
        };
        reader.readAsDataURL(file);
    });

    e.target.value = ''; // 🔴 중요: 같은 파일 재선택 가능
});

let editorImages = []; // 현재 편집 중 이미지 배열

// 에디터 내 첨부 이미지 미리보기
function renderEditorImages() {
    const container = document.getElementById('editor-image-preview');
    container.innerHTML = '';

    editorImages.forEach((img, index) => {
        const div = document.createElement('div');
        div.className = 'image-preview';

        div.innerHTML = `
            <img src="${img}">
            <button onclick="removeEditorImage(${index})">×</button>
        `;

        container.appendChild(div);
    });
}

// 첨부 이미지 삭제
function removeEditorImage(index) {
    editorImages.splice(index, 1);
    renderEditorImages();
}

/**************************************************** 공용 *************************************************/

// 오늘 날짜 얻기 (2025-01-18 형식으로)
function getTodayDate() {
    return new Date().toISOString().slice(0, 10);
}

// ID 에서 날짜 얻기
function formatDateFromId(id) {
    return new Date(id).toISOString().slice(0, 10);
}

// 수정된 게시물 표시하기
function displayDate(item) {
    const date = formatDateFromId(item.id);
    return !item.edited ? date : date + '(수정됨)';
}

// 사용자 id로 이름 참조
function getUserNameById(username) {
    const user = usersCache.find(u => u.username === username);
    return user ? user.name : username;
}

// 사용자 이름으로 id 참조
function getUsernameByName(name) {
    const user = usersCache.find(u => u.name === name);
    return user ? user.username : null;
}

let currentTabId = null;
let previousViewState = null;

// 탭 전환 함수
function showTab(tabId, viewerMode = false) {
    resetUIBeforeNewForm();
    currentTabId = tabId;
    
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

    if (tabId === 'mymenu-tab') {

        // ✅ 리뷰 정렬 상태 초기화
        myReviewSort = 'date';
        myReviewType = 'bean';
        syncReviewTypeButtons();
    
        // ✅ 정렬 토글 텍스트 초기화
        const toggle = document.getElementById('sort-toggle');
        if (toggle) toggle.textContent = '최신순 ▾';

        if (!viewerMode) selectedUser = getCurrentUser();
        initProfile();
        renderMyReviews();
        exitProfileEditMode();
    }

    // 탭 이동 시
    if (tabId === 'board-tab') {
        // ✅ 상태 초기화
        boardCategoryFilter = 'all';
        boardSort = 'latest';

        document.querySelectorAll('.board-category-filter button')
            .forEach(btn => btn.classList.remove('active'));

        document.querySelector(
            '.board-category-filter button[data-category="all"]'
        )?.classList.add('active');
        
        // ✅ 토글 텍스트 초기화
        const toggle = document.getElementById('board-sort-toggle');
        if (toggle) toggle.textContent = '최신순 ▾';
    
        // ✅ 항상 목록 화면부터
        showBoardView('list');
    
        // ✅ 최신순 기준으로 다시 렌더
        renderPostList();
    }

    // 클릭한 버튼 활성화
    const activeBtn = [...document.querySelectorAll('.tab-button')]
        .find(btn => btn.getAttribute('onclick')?.includes(tabId));
    if (activeBtn) activeBtn.classList.add('active');
}

// 로고 버튼 클릭 시 새로고침
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".reload-logo").forEach(logo => {
        logo.addEventListener("click", () => {
            location.reload();
        });
    });
});
