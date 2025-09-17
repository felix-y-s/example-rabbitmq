# Redis 마스터/슬레이브 서버 설정

## 1. 마스터 Redis 서버 설정

### redis-master.conf
```bash
# 기본 설정
port 6379
bind 0.0.0.0
protected-mode yes
requirepass master_password

# 로깅
logfile /var/log/redis/redis-master.log
loglevel notice

# 지속성 설정
save 900 1
save 300 10
save 60 10000
rdbcompression yes
rdbchecksum yes
dbfilename dump-master.rdb
dir /var/lib/redis/

# 네트워크
timeout 300
tcp-keepalive 300
```

## 2. 슬레이브 Redis 서버 설정

### redis-slave.conf
```bash
# 기본 설정
port 6379
bind 0.0.0.0
protected-mode yes
requirepass slave_password

# 마스터 연결 설정
replicaof redis-master.example.com 6379
masterauth master_password

# 읽기 전용 설정
replica-read-only yes

# 로깅
logfile /var/log/redis/redis-slave.log
loglevel notice

# 지속성 설정 (슬레이브는 보통 비활성화)
save ""
rdbcompression yes
rdbchecksum yes
dbfilename dump-slave.rdb
dir /var/lib/redis/
```

## 3. Docker Compose 설정 예시

### docker-compose.yml
```yaml
version: '3.8'

services:
  redis-master:
    image: redis:7-alpine
    container_name: redis-master
    ports:
      - "6379:6379"
    command: redis-server --requirepass master_password
    volumes:
      - redis_master_data:/data
    networks:
      - redis-network

  redis-slave:
    image: redis:7-alpine
    container_name: redis-slave
    ports:
      - "6380:6379"
    command: redis-server --replicaof redis-master 6379 --masterauth master_password --requirepass slave_password --replica-read-only yes
    depends_on:
      - redis-master
    volumes:
      - redis_slave_data:/data
    networks:
      - redis-network

volumes:
  redis_master_data:
  redis_slave_data:

networks:
  redis-network:
    driver: bridge
```

## 4. 시작 명령어

### 마스터 시작
```bash
redis-server /etc/redis/redis-master.conf --daemonize yes
```

### 슬레이브 시작
```bash
redis-server /etc/redis/redis-slave.conf --daemonize yes
```

### Docker Compose 시작
```bash
docker-compose up -d
```

## 5. 상태 확인

### 마스터 상태 확인
```bash
redis-cli -h redis-master.example.com -p 6379 -a master_password
127.0.0.1:6379> INFO replication
```

### 슬레이브 상태 확인
```bash
redis-cli -h redis-slave.example.com -p 6379 -a slave_password
127.0.0.1:6379> INFO replication
```

### 연결 테스트
```bash
# 마스터에 데이터 쓰기
redis-cli -h redis-master.example.com -p 6379 -a master_password
SET test_key "hello"

# 슬레이브에서 데이터 읽기
redis-cli -h redis-slave.example.com -p 6379 -a slave_password
GET test_key
```

## 6. 모니터링

### 복제 지연 확인
```bash
redis-cli -h redis-master.example.com -p 6379 -a master_password
INFO replication
# master_repl_offset 확인

redis-cli -h redis-slave.example.com -p 6379 -a slave_password
INFO replication
# slave_repl_offset 확인
```

### 자동 장애 조치 (Sentinel)
```bash
# Redis Sentinel 설정 (고가용성)
sentinel monitor mymaster redis-master.example.com 6379 2
sentinel auth-pass mymaster master_password
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
```