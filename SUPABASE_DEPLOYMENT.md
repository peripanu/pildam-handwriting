# GitHub Pages + Supabase 배포

현재 상태(2026-09-25): 서울 지역 pildam 프로젝트(ptbbcrrvndahevhbhfib) 생성, DB 마이그레이션과 15분 주기 삭제 작업 적용, Edge Function pildam 배포 완료. 로컬 사용량 9회를 반영했습니다. 비밀값 등록·GitHub 저장소 생성·Pages 배포는 아직입니다. GitHub 브라우저 로그인 대기 중입니다. 기존 로컬 OCR 서버는 그대로 사용 가능합니다.

공개 API 주소: https://ptbbcrrvndahevhbhfib.supabase.co/functions/v1/pildam

## 구성

- GitHub Pages: dist의 정적 화면만 배포. GitHub Free에서는 공개 저장소 필요.
- Supabase Edge Function `pildam`: 수업 코드 로그인, 서명된 8시간 세션 확인, OCR 호출. 세션은 브라우저 메모리에만 있어 새로고침하면 다시 로그인합니다. 원문 문장은 외부 OCR로 전송하지 않습니다.
- Supabase PostgreSQL: 사용량과 임시 인식 결과. RLS 활성화, anon/authenticated 권한 차단. service_role 서버만 접근.
- Google Vision API: 선생님의 기존 키. 비용 한도는 모든 학생 합계 누적 900건(월 자동 초기화 없음).

## 연결 후 진행할 순서

1. Supabase Free 조직에 `pildam` 프로젝트를 생성합니다. DB 비밀번호를 채팅·코드에 남기지 않습니다.
2. `supabase/migrations/202609250001_pildam.sql`을 적용합니다. 실제 Postgres에서 트랜잭션·권한을 검증합니다.
3. 배포 전 로컬 앱의 기존 사용량을 확인해 `pildam_budget.used`에 반영합니다. 0으로 초기화하지 않습니다.
4. Supabase Cron으로 `select public.pildam_cleanup();`를 15분마다 실행합니다. 배포 전 스케줄과 실행 성공을 확인해야 합니다. TTL 자체가 자동 삭제를 수행하지는 않습니다.
5. 함수 비밀 설정: GOOGLE_VISION_API_KEY(기존 Google 키), CLASS_CODE(12자 이상 공유 수업 코드), APP_ORIGIN(실제 GitHub Pages origin). 기본 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY는 서버에서만 사용합니다. 키와 코드를 공개 저장소나 채팅에 기록하지 않습니다.
6. `supabase/functions/pildam`을 배포합니다. config.toml의 verify_jwt=false는 Supabase 사용자 JWT 대신 자체 서명 수업 세션을 확인하기 때문입니다. OCR 인증 검사를 제거하면 안 됩니다.
7. 전용 GitHub 공개 저장소에 소스만 올립니다. .local, .env, .dev.vars, 사진, 키는 제외합니다. 저장소의 루트가 handwriting-check 폴더 내용이 되게 합니다.
8. 저장소 Actions 변수 PILDAM_API_BASE를 실제 `https://<project-ref>.supabase.co/functions/v1/pildam`으로 설정합니다. 비밀값이 아닌 공개 endpoint입니다. 임의 project-ref를 만들지 않습니다.
9. Pages → Source를 GitHub Actions로 설정하고 Publish student app을 수동 실행합니다. 워크플로는 공개 API 주소만 dist/index.html에 주입합니다.
10. 실제 주소의 CORS, 수업 코드 없는 OCR 차단, 코드 로그인, Google OCR 1건, 동시 요청 한도와 중복 결과 재사용을 확인한 후 학생에게 안내합니다.

## 코드 검증

`node tests/supabase.mjs`: CORS, 자체 세션 서명, 키 비노출, 인증 없는 OCR 차단, 결과 재사용·한도 응답, 공개 키 변경 endpoint 없음. DB와 외부 OCR은 모의 응답입니다.
`node tests/comparison.cjs`: 문장 비교.
실제 DB 트랜잭션에서 최초 요청·중복 요청·캐시·900회 제한을 assertion으로 검증 후 롤백했습니다. anon의 함수 실행과 테이블 읽기 권한이 없음을 확인했습니다. Cron 활성화 확인. 보안 점검은 오류/경고 없이 서버 전용 테이블의 RLS 정책 없음 안내만 반환했습니다(의도적으로 클라이언트 접근 차단). 실제 비밀값 설정 후 로그인·OCR 통합 검증이 남아 있습니다.

## 비용·데이터 주의점

- Supabase/GitHub 무료 플랜의 현재 제한은 실제 계정에서 확인합니다. 유료 플랜 신청은 하지 않습니다.
- Google 무료 사용량은 이 앱 외의 요청과 공유될 수 있어 0원 보장이 아닙니다.
- 수업 코드를 아는 사람은 이용할 수 있습니다. 개인 학생 신원 확인 기능은 없습니다.
- 사진 원본은 앱 저장소에 저장하지 않습니다. Google로는 분석할 때 전송됩니다.
- 결과 텍스트는 1시간 재사용 후 정기 삭제합니다. Cron이 꺼지거나 실패하면 삭제가 지연되므로 운영 전 확인합니다.
- GitHub Pages와 Supabase 사이의 CORS는 실제 origin 하나만 허용합니다. CORS 자체는 인증이 아니며, 모든 OCR 요청은 별도로 서명된 세션을 검사합니다.
