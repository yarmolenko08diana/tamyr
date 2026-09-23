// Tamyr: датчик влажности почвы участка.
// Железо: ESP32 + ёмкостный датчик влажности почвы v1.2 (аналоговый выход на GPIO34).
// Раз в час печатает строку CSV "plot_id,date,moisture" в Serial.
// Строки можно сохранить в файл и загрузить в Tamyr кнопкой «Импорт CSV датчика».
//
// Калибровка: запишите сырое значение в сухом воздухе (DRY_RAW) и в стакане воды (WET_RAW).
// Перевод в объёмную влажность здесь линейный и приблизительный: для пилота нужна калибровка по грунту.

#include <WiFi.h>
#include <time.h>

const char* PLOT_ID = "P01";
const int SENSOR_PIN = 34;
const int DRY_RAW = 3000;   // сухой воздух
const int WET_RAW = 1250;   // вода
const float MAX_VWC = 45.0; // % объёмной влажности, соответствующий WET_RAW
const unsigned long PERIOD_MS = 60UL * 60UL * 1000UL;

const char* WIFI_SSID = "";  // пусто: работать без сети, дата будет 1970-01-01
const char* WIFI_PASS = "";

float readMoisture() {
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(SENSOR_PIN);
    delay(20);
  }
  float raw = sum / 16.0;
  float share = (DRY_RAW - raw) / float(DRY_RAW - WET_RAW);
  share = constrain(share, 0.0, 1.0);
  return share * MAX_VWC;
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  if (strlen(WIFI_SSID) > 0) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
    configTime(5 * 3600, 0, "pool.ntp.org");  // Астана, UTC+5
  }
  Serial.println("plot_id,date,moisture");
}

void loop() {
  struct tm t;
  char date[11] = "1970-01-01";
  if (getLocalTime(&t, 2000)) strftime(date, sizeof(date), "%Y-%m-%d", &t);
  Serial.printf("%s,%s,%.1f\n", PLOT_ID, date, readMoisture());
  delay(PERIOD_MS);
}
