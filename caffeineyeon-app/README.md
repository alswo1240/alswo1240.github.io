# 카페인Yeon (Render 배포용)

이 프로젝트는 기존 `localStorage` 기반을 **서버 + DB(SQLite)** 기반으로 이식한 버전입니다.

## 폴더 구조

- `public/` : 프론트(정적 파일)
- `server/` : Express API + 세션 + SQLite
- `render.yaml` : Render에서 바로 읽을 수 있는 설정

## 로컬 실행

```bash
npm install
npm start
# http://localhost:3000
```

## Render 배포 (GitHub 연동)

1. 이 폴더 전체를 GitHub repo로 업로드
2. Render에서 **New +** → **Web Service**
3. repo 선택
4. 설정 (render.yaml을 쓰면 대부분 자동)
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Deploy

> 참고: Render의 무료 플랜은 디스크가 재시작/재배포 시 초기화될 수 있습니다.
> 데이터 영구 보존이 필요하면 Render의 Persistent Disk를 붙이고 `DB_PATH` 환경변수를
> 그 마운트 경로로 지정하세요.
