# 필담

지정 문장을 따라 쓴 사진을 Google Vision OCR로 읽고, 원문과 비교하며 연습하는 손글씨 교정 앱입니다. 문장 일치도는 글씨의 아름다움이나 학생의 능력을 평가하는 점수가 아닙니다.

- 프런트: GitHub Pages (`dist/`)
- 서버: Supabase Edge Function (`supabase/functions/pildam/`)
- 사진 원본 저장 없음, OCR 결과 1시간 캐시 후 정기 삭제
- 공유 수업 코드 로그인, 누적 900건 제한

배포 절차는 [SUPABASE_DEPLOYMENT.md](SUPABASE_DEPLOYMENT.md)를 참고하세요. API 키와 수업 코드는 Supabase Secrets에만 저장합니다.

검증: `node tests/comparison.cjs && node tests/supabase.mjs`
