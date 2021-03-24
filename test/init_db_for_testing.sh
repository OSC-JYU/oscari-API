#! /bin/bash

echo 'test'
docker cp fresh_install_JYU-OSC.sql mariadb:/fresh_install.sql
docker exec mariadb bash -c "mysql -uroot -proot -e 'DROP DATABASE IF EXISTS c_access';"
echo 'database dropped'
docker exec mariadb bash -c "mysql -uroot -proot -e 'CREATE DATABASE c_access';"
echo 'database created'
docker exec mariadb bash -c "mysql -uroot -proot c_access < fresh_install.sql;"
echo 'database fresh install inserted'
