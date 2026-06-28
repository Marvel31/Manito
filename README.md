# 파파라치 마니또

중학교 2학년 반 MT에서 사용할 수 있는 웹앱입니다.

## 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000`으로 접속합니다.

관리자 기본 비밀번호는 `admin1234`입니다. 운영할 때는 환경변수로 바꿀 수 있습니다.

```bash
$env:ADMIN_PASSWORD="새비밀번호"; npm start
```

## 데이터

- 참가자/미션/예상 마니또/순위: `data/db.json`
- 업로드 사진: `data/uploads/`

