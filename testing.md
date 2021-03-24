
# TESTAAMINEN

Testauksessa TYHJENNETÄÄN nykyinen tietokanta!

## Puhtaan asennuksen tekeminen testausta varten

Elasticsearch ei tykkää jos tietokantaskeemaa muutetaan kesken kaiken. Näin voit nollata Elasticin ja tehdä puhtaan asennuksen:

    docker stop elasticsearch7
	docker rm elasticsearch7
	docker stop collectiveaccess_dev
	docker rm collectiveaccess_dev

	sudo rm /var/lib/docker/volumes/oscari-es_esdata1 -rf

	cd oscari-ES
	make start
	cd ..

Seuraavaksi nollataan tietokanta ja käynnistetään CA


	docker exec mariadb bash -c 'mysql -uroot -proot -e "DROP DATABASE c_access"'
	docker exec mariadb bash -c 'mysql -uroot -proot -e "CREATE DATABASE c_access"'

	cd oscari-API
	make start_dev

asenna käyttäen JYU-OSC -profiilia: http://localhost/providence/install

Nyt sinulla pitäisi olla käytössä puhdas asennus.

## Testaus

test -hakemisto sisältää JYU/OSC -profiililla tehdyn CollectiveAccess -asennuksen tietokannan. Tietokantaan on lisätty "test-user" -käyttäjä, jota käytetään testauksessa. Lisäksi tietokannassa on määritelty relaatioattribuutit joillekin relaatioille (tätä ei voi tehdä asennusprofiilissa)

- varmista, että sinulla on toimiva JYU/OSC -profiililla tehty asennus (kts. yllä)
- käynnistä oscari-API lokaalisti (ei-dockeroituna)

      DEBUG=error,debug node index.js

- toisessa terminaalissa:

      npm test
