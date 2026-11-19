/**
 * STRIDE // Running Performance & VDOT Lab
 * Satu file JavaScript untuk:
 * - format pace dan waktu,
 * - integrasi Open-Meteo API,
 * - cuaca dan penyesuaian pace,
 * - navigasi tab,
 * - kalkulator pace, LTHR, dan VDOT.
 */

// Jalankan semua fitur setelah HTML selesai dimuat.
document.addEventListener('DOMContentLoaded', () => {
  initForms();
  initTabs();
  initPaceCalculator();
  initLTHRCalculator();
  initVDOTCalculator();
  initWeatherFeature();
});

// Form tidak dikirim ke server, tetapi Enter tetap nyaman dipakai di input.
function initForms() {
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', event => event.preventDefault());
  });
}

// Helper format waktu dipakai oleh kalkulator dan fitur cuaca.

// Ubah detik menjadi pace, contoh 300 detik menjadi 05:00.
function formatSecondsToPace(sec) {
  if (isNaN(sec) || sec <= 0) return '00:00';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${padZero(m)}:${padZero(s)}`;
}

// Ubah detik menjadi jam:menit:detik, atau menit:detik jika kurang dari 1 jam.
function formatSecondsToTime(totalSec) {
  if (isNaN(totalSec) || totalSec <= 0) return '00:00:00';
  const total = Math.round(totalSec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${padZero(h)}:${padZero(m)}:${padZero(s)}`;
  }
  return `${padZero(m)}:${padZero(s)}`;
}

// Tambahkan nol di depan angka satuan agar format waktu konsisten.
function padZero(num) {
  return num < 10 ? `0${num}` : `${num}`;
}

// Lapisan API: hanya menangani request ke Open-Meteo dan validasi respons.
const OpenMeteoAPI = {
  endpoint: 'https://api.open-meteo.com/v1/forecast',

  // Ambil data cuaca saat ini berdasarkan koordinat lintang dan bujur.
  async getCurrentWeather(lat, lon, signal) {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      timezone: 'auto'
    });

    const response = await fetch(`${this.endpoint}?${params.toString()}`, { signal });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.current) {
      throw new Error('Data cuaca saat ini tidak tersedia.');
    }

    return data.current;
  }
};

// Fitur cuaca memakai data Open-Meteo untuk menyesuaikan pace latihan.

// Siapkan elemen, cache, dan event pada tab cuaca.
function initWeatherFeature() {
  const citySelect = document.getElementById('selectCity');
  const btnGeolocate = document.getElementById('btnGeolocate');
  const btnRefresh = document.getElementById('btnRefreshWeather');
  const basePaceMin = document.getElementById('weatherBasePaceMin');
  const basePaceSec = document.getElementById('weatherBasePaceSec');
  const weatherMetricsGrid = document.getElementById('weatherMetricsGrid');
  const heatAdviceBox = document.getElementById('heatAdviceBox');
  const weatherCondition = document.getElementById('weatherCondition');

  const weatherCache = new Map();
  const WEATHER_CACHE_MS = 10 * 60 * 1000;
  let currentWeatherData = null;
  let weatherLoaded = false;
  let activeRequest = null;

  citySelect.addEventListener('change', () => fetchWeatherData(null, null, null, true));
  btnRefresh.addEventListener('click', () => fetchWeatherData(null, null, null, true));
  btnGeolocate.addEventListener('click', geolocateUser);

  document.addEventListener('stride:tabchange', event => {
    if (event.detail && event.detail.tabId === 'tab-weather' && !weatherLoaded && !activeRequest) {
      fetchWeatherData();
    }
  });

  [basePaceMin, basePaceSec].forEach(input => {
    input.addEventListener('input', () => {
      if (currentWeatherData) {
        calculateHeatPaceAdjustment(currentWeatherData);
      }
    });
  });

  // Minta izin lokasi browser, lalu pakai koordinatnya untuk mengambil cuaca.
  function geolocateUser() {
    if (!navigator.geolocation) {
      alert('Geolokasi tidak didukung oleh browser kamu.');
      return;
    }

    btnGeolocate.textContent = 'Mencari...';
    btnGeolocate.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btnGeolocate.textContent = 'Lokasi GPS';
        btnGeolocate.disabled = false;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        fetchWeatherData(lat, lon, 'Lokasi GPS', true);
      },
      (err) => {
        btnGeolocate.textContent = 'Lokasi GPS';
        btnGeolocate.disabled = false;
        alert('Gagal mendeteksi lokasi GPS: ' + err.message + '. Menggunakan pilihan kota.');
      },
      { timeout: 8000 }
    );
  }

  // Tulis data cuaca ke kartu metrik dan navbar, lalu hitung pace terkoreksi.
  function applyWeatherData(current, cityName) {
    const conditionLabel = describeWeatherCode(current.weather_code);
    currentWeatherData = {
      temp: current.temperature_2m,
      humidity: current.relative_humidity_2m
    };

    document.getElementById('weatherTemp').textContent = `${Math.round(current.temperature_2m)}°C`;
    document.getElementById('weatherHumidity').textContent = `${Math.round(current.relative_humidity_2m)}%`;
    document.getElementById('weatherApparent').textContent = `${Math.round(current.apparent_temperature)}°C`;
    document.getElementById('weatherWind').textContent = `${Math.round(current.wind_speed_10m)} km/h`;
    weatherCondition.textContent = conditionLabel;

    const navQuick = document.getElementById('navQuickWeather');
    if (navQuick) {
      navQuick.querySelector('.quick-weather-city').textContent = cityName;
      navQuick.querySelector('.quick-weather-temp').textContent = `${Math.round(current.temperature_2m)}°C`;
      navQuick.title = `${cityName}: ${conditionLabel}, ${Math.round(current.temperature_2m)}°C`;
    }

    weatherMetricsGrid.classList.remove('is-loading', 'is-error');
    weatherLoaded = true;
    calculateHeatPaceAdjustment(currentWeatherData);
  }

  // Ambil cuaca dari API. Cache 10 menit mencegah request berulang saat tab dibuka lagi.
  async function fetchWeatherData(customLat = null, customLon = null, customCityName = null, force = false) {
    let lat, lon, cityName;

    if (customLat != null && customLon != null) {
      lat = customLat;
      lon = customLon;
      cityName = customCityName || 'Lokasi Saya';
    } else {
      const coords = citySelect.value.split(',');
      lat = coords[0];
      lon = coords[1];
      cityName = citySelect.options[citySelect.selectedIndex].text.split(',')[0];
    }

    if (activeRequest) {
      activeRequest.abort();
      activeRequest = null;
    }

    const cacheKey = `${lat},${lon}`;
    if (!force) {
      const cached = weatherCache.get(cacheKey);
      if (cached && Date.now() - cached.savedAt < WEATHER_CACHE_MS) {
        applyWeatherData(cached.current, cityName);
        return;
      }
    }

    weatherMetricsGrid.classList.add('is-loading');
    weatherMetricsGrid.classList.remove('is-error');
    document.getElementById('weatherTemp').textContent = '...';
    document.getElementById('weatherHumidity').textContent = '...';
    document.getElementById('weatherApparent').textContent = '...';
    document.getElementById('weatherWind').textContent = '...';
    weatherCondition.textContent = 'Memuat...';

    const navQuick = document.getElementById('navQuickWeather');
    if (navQuick) {
      navQuick.querySelector('.quick-weather-city').textContent = cityName;
      navQuick.querySelector('.quick-weather-temp').textContent = '...';
      navQuick.title = `${cityName}: memuat data cuaca`;
    }

    const controller = new AbortController();
    activeRequest = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);

    try {
      const current = await OpenMeteoAPI.getCurrentWeather(lat, lon, controller.signal);

      if (controller !== activeRequest) return;

      weatherCache.set(cacheKey, { current, savedAt: Date.now() });
      applyWeatherData(current, cityName);

    } catch (error) {
      if (error.name === 'AbortError' && !timedOut) return;
      if (controller !== activeRequest) return;

      console.error('Failed to fetch weather:', error);
      currentWeatherData = null;
      weatherLoaded = false;
      weatherMetricsGrid.classList.remove('is-loading');
      weatherMetricsGrid.classList.add('is-error');
      document.getElementById('weatherTemp').textContent = 'Offline';
      document.getElementById('weatherHumidity').textContent = '--';
      document.getElementById('weatherApparent').textContent = '--';
      document.getElementById('weatherWind').textContent = '--';
      weatherCondition.textContent = 'Tidak tersedia';
      document.getElementById('adviceIndicator').style.backgroundColor = '#EF4444';
      heatAdviceBox.style.borderColor = '#EF4444';
      document.getElementById('statAdjustedPace').innerHTML = '-- <span class="stat-unit">/KM</span>';
      document.getElementById('statPaceOffset').textContent = '--';
      document.getElementById('statHeatSum').textContent = '--';
      document.getElementById('adviceTitle').textContent = 'Gagal Mengambil Data Cuaca';
      document.getElementById('adviceDetail').textContent = 'Pastikan perangkat terhubung ke internet untuk mengakses Open-Meteo REST API.';
      document.getElementById('hydrationAdvice').textContent = 'Data cuaca belum tersedia, jadi rekomendasi hidrasi belum bisa dihitung.';

      const navError = document.getElementById('navQuickWeather');
      if (navError) {
        navError.querySelector('.quick-weather-city').textContent = cityName;
        navError.querySelector('.quick-weather-temp').textContent = '--°C';
        navError.title = `${cityName}: data cuaca tidak tersedia`;
      }
    } finally {
      clearTimeout(timeoutId);
      if (activeRequest === controller) activeRequest = null;
    }
  }

  // Estimasi titik embun, lalu perlambat pace sesuai tingkat panas dan kelembapan.
  function calculateHeatPaceAdjustment(weather) {
    const tempC = weather.temp;
    const rh = weather.humidity;

    // Pendekatan titik embun: setiap 5% kekurangan kelembapan menurunkan sekitar 1°C.
    const dewPointC = tempC - ((100 - rh) / 5);
    const heatSum = tempC + dewPointC;

    const pMin = parseInt(basePaceMin.value) || 5;
    const pSec = parseInt(basePaceSec.value) || 0;
    const basePaceInSeconds = (pMin * 60) + pSec;

    let adjustmentPct = 0;
    let statusColor = '#10B981';
    let statusTitle = 'Kondisi Lari Ideal';
    let statusDesc = 'Suhu sejuk dan kelembapan nyaman. Tidak diperlukan penyesuaian pace signifikan.';
    let hydration = 'Minum 150ml air setiap 30 menit lari santai.';

    // Ambang 38, 45, 52, dan 58 adalah batas heat index untuk penyesuaian pace.
    if (heatSum < 38) {
      adjustmentPct = 0;
      statusColor = '#10B981';
      statusTitle = 'Kondisi Lari Sangat Ideal';
      statusDesc = 'Suhu dan kelembapan sangat bersahabat untuk personal best (PB) atau long run.';
      hydration = 'Minum air secukupnya saat merasa haus (150-200ml per 30 menit).';
    } else if (heatSum >= 38 && heatSum < 45) {
      adjustmentPct = 0.02;
      statusColor = '#3B82F6';
      statusTitle = 'Kondisi Hangat Terkontrol';
      statusDesc = 'Mulai terasa hangat. Detak jantung (HR) akan naik sedikit lebih cepat dari biasanya.';
      hydration = 'Minum 150-250ml air setiap 20-25 menit. Perhatikan keringat berlebih.';
    } else if (heatSum >= 45 && heatSum < 52) {
      adjustmentPct = 0.045;
      statusColor = '#F59E0B';
      statusTitle = 'Kondisi Panas & Lembap (Peringatan Sedang)';
      statusDesc = 'Penguapan keringat terhambat oleh kelembapan. Perlambat pace untuk menjaga denyut jantung tetap di Zona Aerobik (Z2).';
      hydration = 'Konsumsi air + elektrolit setiap 20 menit. Hindari lari di siang terik tanpa peneduh.';
    } else if (heatSum >= 52 && heatSum < 58) {
      adjustmentPct = 0.08;
      statusColor = '#EF4444';
      statusTitle = 'Kondisi Panas Ekstrem (Risiko Heat Stress)';
      statusDesc = 'Suhu dan dew point tinggi! Tubuh memompa lebih banyak darah ke kulit untuk pendinginan, mengurangi oksigen ke otot.';
      hydration = 'Wajib hidrasi elektrolit sebelum & setiap 15 menit lari. Turunkan target latihan atau pindah ke treadmill ber-AC.';
    } else {
      adjustmentPct = 0.12;
      statusColor = '#991B1B';
      statusTitle = 'Kondisi Bahaya Overheating';
      statusDesc = 'Sangat tidak disarankan lari intensitas tinggi di luar ruangan. Risiko kram panas, dehidrasi parah, dan heat stroke.';
      hydration = 'Prioritaskan keselamatan. Tunda sesi lari ke malam hari atau lakukan recovery ringan.';
    }

    const offsetSeconds = Math.round(basePaceInSeconds * adjustmentPct);
    const adjustedPaceSeconds = basePaceInSeconds + offsetSeconds;

    document.getElementById('statAdjustedPace').innerHTML =
      `${formatSecondsToPace(adjustedPaceSeconds)} <span class="stat-unit">/KM</span>`;

    document.getElementById('statPaceOffset').textContent =
      offsetSeconds > 0 ? `+${offsetSeconds} dtk/km` : '0 dtk/km (Optimal)';

    document.getElementById('statHeatSum').textContent = `${heatSum.toFixed(1)} °C`;

    const indicator = document.getElementById('adviceIndicator');
    indicator.style.backgroundColor = statusColor;
    heatAdviceBox.style.borderColor = statusColor;
    document.getElementById('adviceTitle').textContent = statusTitle;
    document.getElementById('adviceDetail').textContent = statusDesc;
    document.getElementById('hydrationAdvice').textContent = hydration;
  }

  fetchWeatherData();
}

// Terjemahkan kode cuaca WMO dari Open-Meteo menjadi label Indonesia.
function describeWeatherCode(code) {
  if (code === 0) return 'Cerah';
  if (code === 1) return 'Sebagian Besar Cerah';
  if (code === 2) return 'Berawan Sebagian';
  if (code === 3) return 'Mendung';
  if (code === 45 || code === 48) return 'Berkabut';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Gerimis';
  if ([61, 63, 65, 66, 67].includes(code)) return 'Hujan';
  if ([71, 73, 75, 77].includes(code)) return 'Salju';
  if ([80, 81, 82].includes(code)) return 'Hujan Lokal';
  if (code === 85 || code === 86) return 'Hujan Salju';
  if (code === 95) return 'Badai Petir';
  if (code === 96 || code === 99) return 'Badai Petir dan Hujan Es';
  return 'Kondisi Tidak Diketahui';
}

// Navigasi tab utama dan tombol pintas ke kalkulator VDOT.

// Sinkronkan tombol tab, panel yang tampil, dan status ARIA.
function initTabs() {
  const tabs = Array.from(document.querySelectorAll('.nav-tab'));
  const panels = Array.from(document.querySelectorAll('.calculator-panel'));
  const quickPaceBtn = document.getElementById('btnQuickPaceScroll');

  // Tampilkan satu panel dan sembunyikan panel lain, termasuk saat dipilih lewat keyboard.
  function activateTab(tab, shouldFocus = false) {
    const targetId = tab.getAttribute('data-tab');

    tabs.forEach(t => {
      const isActive = t === tab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', String(isActive));
      t.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    panels.forEach(panel => {
      const isActive = panel.id === targetId;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });

    if (shouldFocus) tab.focus();

    document.dispatchEvent(new CustomEvent('stride:tabchange', {
      detail: { tabId: targetId }
    }));
  }

  // Panah kiri/kanan, Home, dan End memindahkan fokus antar tab.
  tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab));

    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      let nextIndex = null;

      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;

      if (nextIndex !== null) {
        event.preventDefault();
        activateTab(tabs[nextIndex], true);
      }
    });
  });

  const initialTab = tabs.find(tab => tab.classList.contains('active')) || tabs[0];
  if (initialTab) activateTab(initialTab);

  // Tombol hero membuka tab VDOT lalu menggulir ke kalkulator.
  if (quickPaceBtn) {
    quickPaceBtn.addEventListener('click', () => {
      const vdotTab = document.querySelector('.nav-tab[data-tab="tab-vdot"]');
      if (vdotTab) vdotTab.click();
      const suiteElem = document.getElementById('calculator-suite');
      if (suiteElem) suiteElem.scrollIntoView({ behavior: 'smooth' });
    });
  }
}

// Kalkulator segitiga: isi dua nilai, sistem mencari nilai ketiga.

// Siapkan input, preset jarak, mode hitung, dan tabel split.
function initPaceCalculator() {
  const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
  const groupDistance = document.getElementById('groupDistance');
  const groupTime = document.getElementById('groupTime');
  const groupPace = document.getElementById('groupPace');

  const inputDistance = document.getElementById('inputDistance');
  const timeHours = document.getElementById('timeHours');
  const timeMinutes = document.getElementById('timeMinutes');
  const timeSeconds = document.getElementById('timeSeconds');
  const paceMinutes = document.getElementById('paceMinutes');
  const paceSeconds = document.getElementById('paceSeconds');

  const presetPills = document.querySelectorAll('.preset-pill');
  const btnCalculate = document.getElementById('btnCalculatePace');

  let currentMode = 'pace'; // 'pace' | 'time' | 'distance'

  // Tentukan field mana yang disembunyikan sesuai variabel yang dicari.
  function selectMode(btn, shouldFocus = false) {
    modeButtons.forEach(b => {
      const isActive = b === btn;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-checked', String(isActive));
      b.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    currentMode = btn.getAttribute('data-mode');

    // Sembunyikan field yang tidak dipakai mode aktif.
    if (currentMode === 'pace') {
      groupDistance.hidden = false;
      groupTime.hidden = false;
      groupPace.hidden = true;
      document.getElementById('resultPaceTitle').textContent = 'HASIL TARGET PACE';
    } else if (currentMode === 'time') {
      groupDistance.hidden = false;
      groupTime.hidden = true;
      groupPace.hidden = false;
      document.getElementById('resultPaceTitle').textContent = 'HASIL ESTIMASI TOTAL WAKTU';
    } else if (currentMode === 'distance') {
      groupDistance.hidden = true;
      groupTime.hidden = false;
      groupPace.hidden = false;
      document.getElementById('resultPaceTitle').textContent = 'HASIL ESTIMASI JARAK TEMPUH';
    }

    if (shouldFocus) btn.focus();
    calculateTriangular();
  }

  // Pasang event klik dan keyboard pada tombol mode.
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => selectMode(btn));

    btn.addEventListener('keydown', event => {
      const index = modeButtons.indexOf(btn);
      let nextIndex = null;

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (index + 1) % modeButtons.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (index - 1 + modeButtons.length) % modeButtons.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = modeButtons.length - 1;
      }

      if (nextIndex !== null) {
        event.preventDefault();
        selectMode(modeButtons[nextIndex], true);
      }
    });
  });

  // Preset jarak mengisi input dan langsung menghitung.
  presetPills.forEach(pill => {
    pill.addEventListener('click', () => {
      presetPills.forEach(p => {
        const isActive = p === pill;
        p.classList.toggle('active', isActive);
        p.setAttribute('aria-pressed', String(isActive));
      });
      const dist = parseFloat(pill.getAttribute('data-distance'));
      inputDistance.value = dist;
      calculateTriangular();
    });
  });

  // Hitung ulang setiap input berubah atau tombol ditekan.
  [inputDistance, timeHours, timeMinutes, timeSeconds, paceMinutes, paceSeconds].forEach(input => {
    input.addEventListener('input', () => {
      // Jarak manual menonaktifkan preset yang sedang aktif.
      if (input === inputDistance) {
        presetPills.forEach(p => {
          p.classList.remove('active');
          p.setAttribute('aria-pressed', 'false');
        });
      }
      calculateTriangular();
    });
  });

  btnCalculate.addEventListener('click', calculateTriangular);

  // Jalankan mode awal saat halaman dibuka.
  const initialMode = modeButtons.find(btn => btn.classList.contains('active')) || modeButtons[0];
  if (initialMode) selectMode(initialMode);

  // Hitung pace, waktu, atau jarak dari dua nilai yang tersedia.
  function calculateTriangular() {
    const dist = parseFloat(inputDistance.value) || 0;
    const h = parseInt(timeHours.value) || 0;
    const m = parseInt(timeMinutes.value) || 0;
    const s = parseInt(timeSeconds.value) || 0;
    const totalTimeSec = (h * 3600) + (m * 60) + s;

    const pMin = parseInt(paceMinutes.value) || 0;
    const pSec = parseInt(paceSeconds.value) || 0;
    const paceSecPerKm = (pMin * 60) + pSec;

    let finalPaceSec = 0;
    let finalDistKm = 0;
    let finalTimeSec = 0;

    if (currentMode === 'pace') {
      if (dist <= 0 || totalTimeSec <= 0) return;
      finalDistKm = dist;
      finalTimeSec = totalTimeSec;
      finalPaceSec = totalTimeSec / dist;

      // Tampilkan hasil utama.
      document.getElementById('primaryPaceStat').innerHTML = 
        `${formatSecondsToPace(finalPaceSec)} <span class="stat-unit">/KM</span>`;
    } 
    else if (currentMode === 'time') {
      if (dist <= 0 || paceSecPerKm <= 0) return;
      finalDistKm = dist;
      finalPaceSec = paceSecPerKm;
      finalTimeSec = dist * paceSecPerKm;

      // Tampilkan hasil utama.
      document.getElementById('primaryPaceStat').innerHTML = 
        `${formatSecondsToTime(finalTimeSec)} <span class="stat-unit">TOTAL</span>`;
    } 
    else if (currentMode === 'distance') {
      if (totalTimeSec <= 0 || paceSecPerKm <= 0) return;
      finalDistKm = totalTimeSec / paceSecPerKm;
      finalPaceSec = paceSecPerKm;
      finalTimeSec = totalTimeSec;

      // Tampilkan hasil utama.
      document.getElementById('primaryPaceStat').innerHTML = 
        `${finalDistKm.toFixed(2)} <span class="stat-unit">KM</span>`;
    }

    // Tampilkan kecepatan dan pace per mil.
    if (finalPaceSec > 0 && finalDistKm > 0) {
      const speedKmh = 3600 / finalPaceSec;
      const paceMileSec = finalPaceSec * 1.60934;
      document.getElementById('statSpeedKmh').textContent = `${speedKmh.toFixed(2)} km/h`;
      document.getElementById('statPaceMile').textContent = `${formatSecondsToPace(paceMileSec)} /mi`;

      // Perbarui tabel split sesuai hasil.
      renderSplits(finalDistKm, finalPaceSec);
    }
  }

  // Buat tabel split per kilometer, termasuk sisa jarak seperti 0,0975 km.
  function renderSplits(distance, paceSec) {
    const tableBody = document.getElementById('splitsTableBody');
    const splitsSummary = document.getElementById('splitsSummary');
    tableBody.innerHTML = '';

    const wholeKm = Math.floor(distance);
    const remainder = distance - wholeKm;
    const totalSplits = remainder > 0.05 ? wholeKm + 1 : wholeKm;

    splitsSummary.textContent = `${distance.toFixed(2)} KM (${totalSplits} splits)`;

    let cumulativeSec = 0;
    for (let i = 1; i <= wholeKm; i++) {
      cumulativeSec += paceSec;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>KM ${i}</strong></td>
        <td>${formatSecondsToPace(paceSec)}</td>
        <td>${formatSecondsToTime(cumulativeSec)}</td>
      `;
      tableBody.appendChild(row);
    }

    // Sisa jarak (misalnya 0,0975 km) dihitung sebagai split terakhir.
    if (remainder > 0.05) {
      const splitTime = paceSec * remainder;
      cumulativeSec += splitTime;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>KM ${distance.toFixed(2)}</strong> <span class="split-note">(+${(remainder * 1000).toFixed(0)}m)</span></td>
        <td>${formatSecondsToPace(splitTime)}</td>
        <td>${formatSecondsToTime(cumulativeSec)}</td>
      `;
      tableBody.appendChild(row);
    }
  }
}

// LTHR dan zona detak jantung memakai model 5 zona Joe Friel.

// Siapkan pilihan metode LTHR dan tampilkan input yang sesuai.
function initLTHRCalculator() {
  const methodSelect = document.getElementById('lthrMethod');
  const groupFriel = document.getElementById('groupFriel');
  const groupMaxHR = document.getElementById('groupMaxHR');
  const groupAge = document.getElementById('groupAge');

  const inputFrielHR = document.getElementById('inputFrielHR');
  const inputMaxHR = document.getElementById('inputMaxHR');
  const inputAge = document.getElementById('inputAge');
  const btnCalc = document.getElementById('btnCalculateLTHR');

  methodSelect.addEventListener('change', () => {
    const val = methodSelect.value;
    groupFriel.hidden = val !== 'friel';
    groupMaxHR.hidden = val !== 'hrMax';
    groupAge.hidden = val !== 'ageFormula';
    calculateLTHR();
  });

  [inputFrielHR, inputMaxHR, inputAge].forEach(input => {
    input.addEventListener('input', calculateLTHR);
  });

  btnCalc.addEventListener('click', calculateLTHR);

  // Hitung zona awal saat halaman dibuka.
  calculateLTHR();

  // Hitung LTHR dari metode Friel, persentase HR Max, atau formula Gellish.
  function calculateLTHR() {
    const method = methodSelect.value;
    let lthr = 168;
    let methodNameText = 'Joe Friel 30-min TT';

    if (method === 'friel') {
      lthr = parseInt(inputFrielHR.value) || 168;
      methodNameText = 'Joe Friel 30-min TT (Avg 20m)';
    } else if (method === 'hrMax') {
      const maxHr = parseInt(inputMaxHR.value) || 190;
      lthr = Math.round(maxHr * 0.88); // Perkiraan 88% dari detak jantung maksimal.
      methodNameText = `Estimasi 88% dari Max HR (${maxHr} BPM)`;
    } else if (method === 'ageFormula') {
      const age = parseInt(inputAge.value) || 22;
      const calculatedMax = Math.round(207 - (0.7 * age)); // Formula Gellish untuk detak jantung maksimal.
      lthr = Math.round(calculatedMax * 0.88);
      methodNameText = `Formula Gellish (Max: ${calculatedMax} BPM)`;
    }

    document.getElementById('statLTHRValue').innerHTML = `${lthr} <span class="stat-unit">BPM</span>`;
    document.getElementById('statLTHRMethod').textContent = methodNameText;
    document.getElementById('statThresholdRange').textContent = `${Math.round(lthr * 0.95)} - ${Math.round(lthr * 1.02)} BPM`;

    renderHRZones(lthr);
  }

  // Bagi LTHR menjadi 5 zona latihan lalu render kartunya.
  function renderHRZones(lthr) {
    const container = document.getElementById('hrZonesContainer');
    container.innerHTML = '';

    // Batas setiap zona mengikuti model 5 zona Joe Friel.
    const zones = [
      {
        id: 'z1',
        num: 'Z1',
        name: 'Zone 1: Active Recovery',
        desc: 'Pemulihan pasca lari berat, sangat ringan (< 85% LTHR)',
        min: 0,
        max: Math.round(lthr * 0.85) - 1,
        rangeLabel: `< ${Math.round(lthr * 0.85)}`
      },
      {
        id: 'z2',
        num: 'Z2',
        name: 'Zone 2: Aerobic Base (Easy)',
        desc: 'Membangun mitokondria, pembakaran lemak (85% - 89% LTHR)',
        min: Math.round(lthr * 0.85),
        max: Math.round(lthr * 0.89),
        rangeLabel: `${Math.round(lthr * 0.85)} - ${Math.round(lthr * 0.89)}`
      },
      {
        id: 'z3',
        num: 'Z3',
        name: 'Zone 3: Tempo / Aerobic Endurance',
        desc: 'Kenyamanan terkontrol, ritme marathon (90% - 94% LTHR)',
        min: Math.round(lthr * 0.90),
        max: Math.round(lthr * 0.94),
        rangeLabel: `${Math.round(lthr * 0.90)} - ${Math.round(lthr * 0.94)}`
      },
      {
        id: 'z4',
        num: 'Z4',
        name: 'Zone 4: Sub-Threshold (Sweet Spot)',
        desc: 'Tepat di ambang asam laktat, napas berat (95% - 99% LTHR)',
        min: Math.round(lthr * 0.95),
        max: Math.round(lthr * 0.99),
        rangeLabel: `${Math.round(lthr * 0.95)} - ${Math.round(lthr * 0.99)}`
      },
      {
        id: 'z5',
        num: 'Z5',
        name: 'Zone 5: Anaerobic / Max Effort',
        desc: 'VO2 Max intervals, sprint all-out (> 100% LTHR)',
        min: Math.round(lthr * 1.00),
        max: 220,
        rangeLabel: `≥ ${Math.round(lthr * 1.00)}`
      }
    ];

    zones.forEach(z => {
      const item = document.createElement('div');
      item.className = 'zone-item';
      item.innerHTML = `
        <div class="zone-badge ${z.id}">${z.num}</div>
        <div class="zone-meta">
          <span class="zone-name">${z.name}</span>
          <span class="zone-desc">${z.desc}</span>
        </div>
        <div class="zone-range">${z.rangeLabel} <span class="bpm-unit">BPM</span></div>
      `;
      container.appendChild(item);
    });
  }
}

// VDOT Jack Daniels: skor aerobik, pace latihan, dan prediksi waktu lomba.

// Siapkan input PB dan hitung ulang setiap nilai berubah.
function initVDOTCalculator() {
  const distSelect = document.getElementById('vdotRaceDistance');
  const vdotHours = document.getElementById('vdotHours');
  const vdotMinutes = document.getElementById('vdotMinutes');
  const vdotSeconds = document.getElementById('vdotSeconds');
  const btnCalc = document.getElementById('btnCalculateVDOT');

  [distSelect, vdotHours, vdotMinutes, vdotSeconds].forEach(el => {
    el.addEventListener('change', calculateVDOT);
    el.addEventListener('input', calculateVDOT);
  });

  btnCalc.addEventListener('click', calculateVDOT);

  calculateVDOT();

  // Ubah waktu lomba menjadi VO2 dan VDOT memakai rumus Daniels-Gilbert.
  function calculateVDOT() {
    const distMeters = parseFloat(distSelect.value) || 5000;
    const h = parseInt(vdotHours.value) || 0;
    const m = parseInt(vdotMinutes.value) || 0;
    const s = parseInt(vdotSeconds.value) || 0;
    const totalSec = (h * 3600) + (m * 60) + s;

    if (totalSec <= 0 || distMeters <= 0) return;

    const timeMin = totalSec / 60;
    const velocity = distMeters / timeMin; // meters per minute

    // Rumus VO2 Daniels-Gilbert: kecepatan menentukan kebutuhan oksigen.
    const vo2 = -4.60 + (0.182258 * velocity) + (0.000104 * Math.pow(velocity, 2));
    const percentVO2max = 0.8 + 
      (0.1894393 * Math.exp(-0.012778 * timeMin)) + 
      (0.2989558 * Math.exp(-0.1932605 * timeMin));

    const vdot = vo2 / percentVO2max;

    // Tampilkan skor VDOT utama.
    document.getElementById('statVDOTValue').innerHTML = `${vdot.toFixed(1)} <span class="stat-unit">VDOT</span>`;

    const heroVdotValue = document.getElementById('heroVdotValue');
    if (heroVdotValue) heroVdotValue.textContent = vdot.toFixed(1);

    // Kategori performa berdasarkan rentang VDOT.
    let tier = 'Beginner Runner';
    if (vdot >= 65) tier = 'Elite / National Class';
    else if (vdot >= 55) tier = 'Advanced Competitor';
    else if (vdot >= 45) tier = 'Intermediate Runner';
    else if (vdot >= 35) tier = 'Novice Runner';
    document.getElementById('statRunnerTier').textContent = tier;

    // Pace dasar dari waktu lomba yang diinput.
    const basePaceSec = totalSec / (distMeters / 1000);
    document.getElementById('statVdotBasePace').textContent = `${formatSecondsToPace(basePaceSec)} /km`;

    renderTrainingPaces(vdot);

    renderRaceEquivalencies(vdot);
  }

  // Kebalikan rumus VO2: cari kecepatan (meter/menit) dari target VO2.
  function getVelocityFromVO2(targetVO2) {
    const a = 0.000104;
    const b = 0.182258;
    const c = -(4.60 + targetVO2);
    // Ambil akar positif dari persamaan kuadrat.
    const v = (-b + Math.sqrt(Math.pow(b, 2) - 4 * a * c)) / (2 * a);
    return v; // meter per menit
  }

  // Terjemahkan persentase VDOT menjadi pace E, M, T, I, dan R.
  function renderTrainingPaces(vdot) {
    const container = document.getElementById('trainingPacesContainer');
    container.innerHTML = '';

    // Intensitas latihan standar Jack Daniels dalam persen VDOT.
    const trainingTypes = [
      { tag: 'EASY (E)', name: 'Aerobic / Recovery (65% VDOT)', pct: 0.65 },
      { tag: 'MARATHON (M)', name: 'Steady Pace (79% VDOT)', pct: 0.79 },
      { tag: 'THRESHOLD (T)', name: 'Lactate Threshold (88% VDOT)', pct: 0.88 },
      { tag: 'INTERVAL (I)', name: 'VO2 Max Intervals (97.5% VDOT)', pct: 0.975 },
      { tag: 'REPETITION (R)', name: 'Speed & Economy (105% VDOT)', pct: 1.05 }
    ];

    trainingTypes.forEach(t => {
      const targetVO2 = vdot * t.pct;
      const v = getVelocityFromVO2(targetVO2);
      const paceSecPerKm = (1000 / v) * 60;

      const tile = document.createElement('div');
      tile.className = 'pace-tile';
      tile.innerHTML = `
        <span class="pace-tile-tag">${t.tag}</span>
        <div class="pace-tile-name">${t.name}</div>
        <div class="pace-tile-value">${formatSecondsToPace(paceSecPerKm)} <span class="pace-tile-unit">/km</span></div>
      `;
      container.appendChild(tile);
    });
  }

  // Cari waktu lomba lewat binary search sampai VDOT hasil hitung mendekati target.
  function predictRaceTime(distanceMeters, targetVDOT) {
    let low = 2.0; // menit
    let high = 500.0; // menit
    let bestTime = high;

    for (let i = 0; i < 30; i++) {
      const midTime = (low + high) / 2;
      const v = distanceMeters / midTime;
      const vo2 = -4.60 + (0.182258 * v) + (0.000104 * Math.pow(v, 2));
      const f = 0.8 + (0.1894393 * Math.exp(-0.012778 * midTime)) + (0.2989558 * Math.exp(-0.1932605 * midTime));
      const calculatedVDOT = vo2 / f;

      if (calculatedVDOT > targetVDOT) {
        // Terlalu cepat, waktu masih bisa ditambah.
        low = midTime;
      } else {
        high = midTime;
        bestTime = midTime;
      }
    }
    return bestTime * 60; // hasil dalam detik
  }

  // Tampilkan prediksi waktu untuk jarak lomba umum.
  function renderRaceEquivalencies(vdot) {
    const container = document.getElementById('raceEquivContainer');
    container.innerHTML = '';

    const races = [
      { name: '1.500 Meter (1,5K)', dist: 1500 },
      { name: '5 Kilometer (5K)', dist: 5000 },
      { name: '10 Kilometer (10K)', dist: 10000 },
      { name: 'Half Marathon (21.1K)', dist: 21097.5 },
      { name: 'Full Marathon (42.2K)', dist: 42195 }
    ];

    races.forEach(r => {
      const predictedSec = predictRaceTime(r.dist, vdot);
      const tile = document.createElement('div');
      tile.className = 'race-tile';
      tile.innerHTML = `
        <span class="race-dist">${r.name}</span>
        <span class="race-time">${formatSecondsToTime(predictedSec)}</span>
      `;
      container.appendChild(tile);
    });
  }
}
