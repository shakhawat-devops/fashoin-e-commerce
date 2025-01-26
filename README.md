
# Fashion E-Commerce Platform

A microservices-based e-commerce platform for fashion retail built with Node.js, React, MongoDB, and PostgreSQL.

## System Architecture

The platform consists of five microservices:
1. User Management Service (Port 3001)
2. Product Management Service (Port 3002)
3. Order and Payment Service (Port 3003)
4. Recommendation Service (Port 3004)
5. Analytics Service (Port 3005)

## Prerequisites

- Docker and Docker Compose
- Node.js v16 or higher (for local development)
- Git

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/shakhawat-devops/fashoin-e-commerce.git
cd fashoin-ecommerce
```
Stop any local instances of MongoDB and PostgreSQL if running:

```bash
sudo systemctl stop mongodb
sudo systemctl stop postgresql
```

Start all services using Docker Compose:

```bash
docker-compose up --build
```
Testing the Services
# 1. Register and login as seller
``` bash
curl -X POST http://localhost:3001/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "seller@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Seller",
    "role": "seller"
  }'
```
```bash
SELLER_RESPONSE=$(curl -X POST http://localhost:3001/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "seller@example.com",
    "password": "password123"
  }')
```
# Get the login token
```bash
SELLER_TOKEN=$(echo $SELLER_RESPONSE | jq -r '.token')
```
# 2. Add product
```bash
PRODUCT_RESPONSE=$(curl -X POST http://localhost:3002/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -d '{
    "name": "Test Product",
    "description": "Test Description",
    "price": 99.99,
    "category": "Clothing",
    "sizes": ["S", "M", "L"],
    "colors": [{"name": "Black", "hexCode": "#000000"}],
    "stock": 10,
    "images": [{"url": "/api/placeholder/300/400", "isPrimary": true}]
  }')
```
```bash
PRODUCT_ID=$(echo $PRODUCT_RESPONSE | jq -r '._id')
```
# 3. Register and Login as user
```bash
curl -X POST http://localhost:3001/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```
```bash
USER_RESPONSE=$(curl -X POST http://localhost:3001/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }')
```
# Get the login token
```bash
USER_TOKEN=$(echo $USER_RESPONSE | jq -r '.token')
```

# 4. Add to cart
```bash
curl -X POST http://localhost:3003/cart/add \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d "{
    \"product_id\": \"$PRODUCT_ID\",
    \"quantity\": 1,
    \"price\": 99.99
  }"
```
# 5. View cart
```bash
curl -X GET http://localhost:3003/cart \
  -H "Authorization: Bearer $USER_TOKEN"
```

# 6. Register and login as Admin
``` bash
curl -X POST http://localhost:3001/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Seller",
    "role": "admin"
  }'
```
``` bash
ADMIN_RESPONSE=$(curl -X POST http://localhost:3001/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123"
  }')
```
``` bash
ADMIN_TOKEN=$(echo $ADMIN_RESPONSE | jq -r '.token')
```
# Get sales analytics
``` bash
curl -X GET http://localhost:3005/analytics/report/sales \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "startDate": "2024-01-01",
    "endDate": "2024-12-31"
  }'
```
# Get traffic analytics
``` bash
curl -X GET http://localhost:3005/analytics/report/traffic \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "startDate": "2024-01-01",
    "endDate": "2024-12-31"
  }'
```
``` bash
# Get product performance analytics
curl -X GET http://localhost:3005/analytics/report/products \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Accessing Services

Frontend: http://localhost:3000
User Service: http://localhost:3001
Product Service: http://localhost:3002
Order Service: http://localhost:3003
Recommendation Service: http://localhost:3004
Analytics Service: http://localhost:3005

Useful Docker Commands

Start services
```bash
docker-compose up
```
# Start services in background
docker-compose up -d

# Stop services
docker-compose down

# Remove volumes when stopping
docker-compose down -v

# View logs
docker-compose logs

# View logs for specific service
docker-compose logs service-name

# Rebuild services
docker-compose up --build
Database Access
MongoDB
``` bash
# Access MongoDB shell
docker exec -it fashion-ecommerce-docker-mongodb-1 mongosh
```

# Use specific database
use fashion-ecommerce-users
PostgreSQL
``` bash
# Access PostgreSQL shell
docker exec -it fashion-postgres psql -U admin -d fashion_ecommerce_orders
```

# Basic PostgreSQL commands
\l    # List databases
\dt   # List tables
\q    # Quit
Troubleshooting

Port Conflicts

Ensure no local services are using the required ports
Stop local MongoDB: sudo systemctl stop mongodb
Stop local PostgreSQL: sudo systemctl stop postgresql


Database Connection Issues

Check if databases are running: docker-compose ps
Verify environment variables in .env files
Check service logs: docker-compose logs service-name


Docker Issues

Clean up unused resources: docker system prune
Remove all containers: docker-compose down
Remove all volumes: docker volume rm $(docker volume ls -q)
