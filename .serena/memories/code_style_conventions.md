# 코드 스타일 및 컨벤션

## TypeScript 설정
- **Module System**: ESNext, Node.js 네이티브 해상도
- **Target**: ES2023
- **Strict Mode**: 부분적 엄격 모드 (strictNullChecks: true)
- **Decorators**: 실험적 데코레이터 활성화

## ESLint 규칙
- **@typescript-eslint/no-explicit-any**: 비활성화
- **@typescript-eslint/no-floating-promises**: 경고
- **@typescript-eslint/no-unsafe-argument**: 경고
- **Prettier 통합**: 포매팅 규칙 적용

## Prettier 설정
- **singleQuote**: true (작은따옴표 사용)
- **trailingComma**: all (후행 쉼표 사용)

## 명명 규칙
- **파일명**: kebab-case 또는 camelCase
- **클래스명**: PascalCase
- **변수/함수명**: camelCase
- **상수**: UPPER_SNAKE_CASE
- **인터페이스/타입**: PascalCase

## 구조적 컨벤션
- **모듈화**: 기능별 모듈 분리
- **Repository 패턴**: 데이터 접근 계층 분리
- **DTO 클래스**: class-validator 데코레이터 사용
- **Global 모듈**: @Global() 데코레이터로 전역 모듈 표시

## 로깅 및 에러 처리
- **Logger**: NestJS Logger 클래스 사용
- **에러 메시지**: 한글 메시지 사용
- **HttpException**: 구조화된 에러 응답

## 주석 규칙
- **한글 주석**: 모든 주석은 한글로 작성
- **JSDoc**: 필요시 타입 문서화
- **설명 주석**: 복잡한 로직에 대한 설명