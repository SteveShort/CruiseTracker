// ================================================================
//  Cruise Dashboard ??" Application Logic
// ================================================================

// ?"??"? State ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
let allCruises = [];
let allShips = [];
let currentSort = { field: 'departureDate', dir: 'asc' };
let priceChart = null;
let calendarEvents = [];
let monthPickerStart = null; // year*12 + month
let monthPickerEnd = null;
let calViewYear = new Date().getFullYear();
let calViewMonth = new Date().getMonth();

// ?"??"? Init ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initDashboardFilters();
    initCruiseFilters();
    initTableSort();
    initModal();
    initCalendar();
    initInfoModal();
    loadDashboard();
});

// ================================================================
//  MODALS & INFO
// ================================================================

function initInfoModal() {
    const btn = document.getElementById('valueInfoBtn');
    const modal = document.getElementById('valueInfoModal');
    const close = document.getElementById('valueInfoClose');
    if (btn && modal && close) {
        btn.addEventListener('click', () => modal.classList.add('active'));
        close.addEventListener('click', () => modal.classList.remove('active'));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }
}

// ================================================================
//  TABS
// ================================================================

function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });
}

// ================================================================
//  DATA LOADING
// ================================================================

async function loadDashboard() {
    try {
        const mode = getDiningMode();
        const [stats, cruises, ships, filterOpts, calEvts] = await Promise.all([
            fetch('/api/stats').then(r => r.json()),
            fetch('/api/cruises?mode=' + mode).then(r => r.json()),
            fetch('/api/ships').then(r => r.json()),
            fetch('/api/filter-options').then(r => r.json()),
            fetch('/api/calendar-events').then(r => r.json()),
        ]);

        allCruises = cruises;
        allShips = ships;
        calendarEvents = calEvts;
        renderCalendar();

        // Populate checkbox dropdown filters from DB
        populateCheckboxDropdown('dashFilterLinePanel', filterOpts.lines, 'Lines');
        populateCheckboxDropdown('dashFilterShipPanel', filterOpts.ships, 'Ships');
        populateCheckboxDropdown('dashFilterPortPanel', filterOpts.ports, 'Ports');

        // Ship Reference tab multi-selects
        populateCheckboxDropdown('filterShipLinePanel', filterOpts.lines, 'Lines');

        initCheckboxDropdowns();
        // Wire up nights panel checkboxes
        document.querySelectorAll('#dashFilterNightsPanel input').forEach(cb => {
            cb.addEventListener('change', () => {
                updateDropdownLabel('dashFilterNightsPanel', 'Nights');
                applyDashboardFilters();
            });
        });

        initMonthPicker();
        renderStats(stats);
        applyDashboardFilters();
        applyFilters();
        renderShips(ships);

        document.getElementById('cruiseBadge').textContent = cruises.length;
        document.getElementById('totalCount').textContent = `${cruises.length} upcoming sailings`;

        if (stats.lastScraped) {
            const d = new Date(stats.lastScraped);
            document.getElementById('lastScrape').textContent = formatDate(d) + ' ' + formatTime(d);
        }

        // Scraper health indicators (one per scraper)
        if (stats.scraperHealth && Array.isArray(stats.scraperHealth)) {
            const el = document.getElementById('scraperHealth');
            if (el) {
                const labels = { 'NCL': 'NCL', 'Disney': 'Disney', 'Disney-FL': 'FL Res' };
                const parts = stats.scraperHealth.map(sh => {
                    const completedAt = new Date(sh.completedAt);
                    const hoursAgo = Math.round((Date.now() - completedAt.getTime()) / 3600000);
                    const isHealthy = sh.status === 'Success' && hoursAgo < 48;
                    const isStale = hoursAgo >= 48;
                    const dot = isHealthy ? '🟢' : (sh.status !== 'Success' ? '🔴' : (isStale ? '🟡' : '🟢'));
                    const timeStr = hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.round(hoursAgo / 24)}d ago`;
                    const label = labels[sh.scraperName] || sh.scraperName;
                    const title = `Status: ${sh.status} | Found: ${sh.sailingsFound} | Updated: ${sh.sailingsUpdated}${sh.errors ? ' | Errors: ' + sh.errors : ''}`;
                    return `<span title="${title}">${dot} ${label}</span>`;
                });
                el.innerHTML = parts.join('&nbsp;&nbsp;');
            }
        } else if (stats.scraperHealth) {
            // Backwards compat: single object
            const sh = stats.scraperHealth;
            const completedAt = new Date(sh.completedAt);
            const hoursAgo = Math.round((Date.now() - completedAt.getTime()) / 3600000);
            const isHealthy = sh.status === 'Success' && hoursAgo < 48;
            const isStale = hoursAgo >= 48;
            const dot = isHealthy ? '🟢' : isStale ? '🟡' : '🔴';
            const timeStr = hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.round(hoursAgo / 24)}d ago`;
            const el = document.getElementById('scraperHealth');
            if (el) {
                el.innerHTML = `${dot} NCL: ${sh.sailingsFound} sailings ${timeStr}`;
                el.title = `Status: ${sh.status} | Found: ${sh.sailingsFound} | Updated: ${sh.sailingsUpdated}${sh.errors ? ' | Errors: ' + sh.errors : ''}`;
            }
        }
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        document.getElementById('dealsContainer').innerHTML =
            '<div class="empty-state"><div class="empty-icon">&#x26A0;&#xFE0F;</div><p>Failed to load data. Is the scraper running?</p></div>';
    }
}

// ================================================================
//  STATS CARDS
// ================================================================

function renderStats(stats) {
    document.getElementById('statSailings').textContent = stats.totalSailings.toLocaleString();
    document.getElementById('statShips').textContent = stats.uniqueShips;
    document.getElementById('statBalcony').textContent = stats.cheapestBalconyPPD
        ? '$' + Math.round(stats.cheapestBalconyPPD) : '\u2014';
    document.getElementById('statSuite').textContent = stats.cheapestSuitePPD
        ? '$' + Math.round(stats.cheapestSuitePPD) : '\u2014';
}

// ================================================================
//  DASHBOARD - Family-Focused View
// ================================================================

function initDashboardFilters() {
    ['dashFilterSuiteLevel', 'dashOrderBy'].forEach(id => {
        document.getElementById(id).addEventListener('change', applyDashboardFilters);
    });
    // Sliders
    ['dashFilterMaxPpd', 'dashFilterMaxTotal'].forEach(id => {
        const slider = document.getElementById(id);
        const labelEl = document.getElementById(id + 'Label');
        slider.addEventListener('input', () => {
            const val = parseInt(slider.value);
            const max = parseInt(slider.max);
            labelEl.textContent = val >= max ? 'Max' : '$' + val.toLocaleString();
            debounce(applyDashboardFilters, 200)();
        });
    });
    // Star filter dropdown
    document.getElementById('dashFilterStars').addEventListener('change', applyDashboardFilters);
    ['dashFilterHideSoldOut', 'dashFilterKidsOnly', 'dashFilterShipWithinShip', 'dashFilterFLResident', 'dashFilterTransatlantic', 'dashFilterNoConflicts'].forEach(id => {
        document.getElementById(id).addEventListener('change', applyDashboardFilters);
    });
    // Value weight sliders
    initValueWeightSliders();
}

function initValueWeightSliders() {
    const toggle = document.getElementById('valueWeightsToggle');
    const panel = document.getElementById('valueWeightsPanel');
    if (toggle && panel) {
        toggle.addEventListener('click', () => {
            panel.classList.toggle('expanded');
            toggle.classList.toggle('active');
        });
    }
    ['weightKids', 'weightShip', 'weightDining', 'weightPrice'].forEach(id => {
        const slider = document.getElementById(id);
        const label = document.getElementById(id + 'Val');
        if (!slider || !label) return;
        slider.addEventListener('input', () => {
            label.textContent = slider.value;
            debounce(applyDashboardFilters, 150)();
        });
    });

    // Cruise line value bonus dropdowns — populate -30 to +30 (step 5)
    document.querySelectorAll('.line-bonus-select').forEach(sel => {
        sel.innerHTML = '';
        for (let v = -30; v <= 30; v += 5) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = (v > 0 ? '+' : '') + v;
            sel.appendChild(opt);
        }
        // Restore from localStorage
        const saved = localStorage.getItem('bonus_' + sel.id);
        if (saved !== null) sel.value = saved;
        else sel.value = '0';
        sel.addEventListener('change', () => {
            localStorage.setItem('bonus_' + sel.id, sel.value);
            applyDashboardFilters();
        });
    });

    // Dining mode toggle - re-fetch data from API with mode parameter
    const modeToggle = document.getElementById('diningModeToggle');
    if (modeToggle) {
        modeToggle.querySelectorAll('.dining-mode-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                modeToggle.querySelectorAll('.dining-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                // Re-fetch cruises with mode parameter for server-side filtering
                try {
                    const cruises = await fetch('/api/cruises?mode=' + mode).then(r => r.json());
                    allCruises = cruises;
                } catch (err) {
                    console.error('Failed to re-fetch cruises:', err);
                }
                // Reset price sliders to max so suite-range prices aren't filtered out
                const ppdSlider = document.getElementById('dashFilterMaxPpd');
                ppdSlider.value = ppdSlider.max;
                document.getElementById('dashFilterMaxPpdLabel').textContent = 'Max';
                const totalSlider = document.getElementById('dashFilterMaxTotal');
                totalSlider.value = totalSlider.max;
                document.getElementById('dashFilterMaxTotalLabel').textContent = 'Max';
                applyDashboardFilters();
            });
        });
    }
}

function getDiningMode() {
    const active = document.querySelector('.dining-mode-btn.active');
    return active ? active.dataset.mode : 'main';
}

function hasValidPrice(c) {
    const bOk = c.balconyPrice !== null && c.balconyPrice !== undefined && c.balconyPrice > 0;
    const sOk = c.suitePrice !== null && c.suitePrice !== undefined && c.suitePrice > 0;
    return bOk || sOk;
}

// ?"??"? Kids Club Assignment ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
const OUR_KIDS = [
    { name: 'Jack', birthday: new Date(2016, 8, 3) },  // Sep 3, 2016
    { name: 'Eric', birthday: new Date(2019, 3, 2) },  // Apr 2, 2019
];

function ageOnDate(birthday, date) {
    let age = date.getFullYear() - birthday.getFullYear();
    const m = date.getMonth() - birthday.getMonth();
    if (m < 0 || (m === 0 && date.getDate() < birthday.getDate())) age--;
    return age;
}

function kidsClubAssignment(cruiseLine, departureDate) {
    const depDate = typeof departureDate === 'string'
        ? new Date(departureDate + 'T00:00:00') : departureDate;

    const clubs = {
        Norwegian: [
            { name: 'Turtles \uD83D\uDC22', min: 3, max: 5 },
            { name: 'Seals \uD83E\uDDA6', min: 6, max: 9 },
            { name: 'Dolphins \uD83D\uDC2C', min: 10, max: 12 },
            { name: 'Entourage', min: 13, max: 17 },
        ],
        Disney: [
            { name: 'Oceaneer Club', min: 3, max: 10 },
            { name: 'Edge', min: 11, max: 14 },
            { name: 'Vibe', min: 15, max: 17 },
        ],
        Celebrity: [
            { name: 'Ship Mates', min: 3, max: 5 },
            { name: 'Cadets', min: 6, max: 9 },
            { name: 'Captains', min: 10, max: 12 },
            { name: 'Teens', min: 13, max: 17 },
        ],
    };

    const lineClubs = clubs[cruiseLine] || [];
    const assigned = new Map(); // club name -> { min, max, ages: [] }

    OUR_KIDS.forEach(kid => {
        const age = ageOnDate(kid.birthday, depDate);
        const match = lineClubs.find(c => age >= c.min && age <= c.max);
        if (match) {
            if (!assigned.has(match.name)) {
                assigned.set(match.name, { min: match.min, max: match.max });
            }
        }
    });

    return [...assigned.entries()].map(([name, range]) =>
        `${name} ages ${range.min}-${range.max}`
    );
}

function kidsClubBadges(cruiseLine, departureDate, hasKids) {
    if (!hasKids) return '<span class="kids-tag none">&#x274C; No Kids Program</span>';
    const clubs = kidsClubAssignment(cruiseLine, departureDate);
    if (clubs.length === 0) return '<span class="kids-tag">&#x1F476; Kids Program</span>';
    return clubs.map(c => `<span class="kids-tag">&#x1F476; ${c}</span>`).join('');
}

// ?"??"? Dynamic Dining Math ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?
function getDynamicDiningScore(c, mode) {
    const mdrScore = c.mainDiningScore || 0;

    if (mode === 'main') return mdrScore;
    if (mode === 'suite') return c.suiteDiningScore || mdrScore;

    if (mode === 'package') {
        const specScore = c.packageDiningScore || mdrScore;
        const nights = c.nights || 7;

        // Define specialty venue capacity caps
        let cap = 7;
        let fatiguePenalty = 15;
        if (c.cruiseLine === 'Disney') cap = 2; // Palo + Remy/Enchante
        else if (c.cruiseLine === 'Celebrity') cap = 4; // 4 top tier venues before repeats
        else if (c.cruiseLine === 'Norwegian') cap = 7; // Extremely high variety

        // If the cruise line is Disney, they strictly enforce the limit per cruise, 
        // forcing a fallback to MDR for the remaining nights.
        if (c.cruiseLine === 'Disney') {
            const specNights = Math.min(nights, cap);
            const mdrNights = Math.max(0, nights - specNights);
            return Math.round(((specScore * specNights) + (mdrScore * mdrNights)) / nights);
        } else {
            // For other lines with unlimited packages, if you stay past the cap, 
            // you suffer menu fatigue (-15 points) on the repeated restaurants. 
            // (You will logically fallback to MDR if MDR > fatigued score)
            let totalScore = 0;
            for (let i = 1; i <= nights; i++) {
                if (i <= cap) {
                    totalScore += specScore;
                } else {
                    const fatiguedSpec = specScore - fatiguePenalty;
                    totalScore += Math.max(mdrScore, fatiguedSpec);
                }
            }
            return Math.round(totalScore / nights);
        }
    }
    return 0;
}

function clearAllFilters() {
    // Selects
    document.getElementById('dashFilterStars').value = '0';
    document.getElementById('dashFilterSuiteLevel').value = '';

    // Sliders — reset to max
    const ppdSlider = document.getElementById('dashFilterMaxPpd');
    ppdSlider.value = ppdSlider.max;
    document.getElementById('dashFilterMaxPpdLabel').textContent = 'Max';
    const totalSlider = document.getElementById('dashFilterMaxTotal');
    totalSlider.value = totalSlider.max;
    document.getElementById('dashFilterMaxTotalLabel').textContent = 'Max';

    // Checkbox toggles — restore defaults
    document.getElementById('dashFilterHideSoldOut').checked = true;
    document.getElementById('dashFilterKidsOnly').checked = true;
    document.getElementById('dashFilterShipWithinShip').checked = false;
    document.getElementById('dashFilterFLResident').checked = false;

    document.getElementById('dashFilterTransatlantic').checked = false;
    document.getElementById('dashFilterNoConflicts').checked = false;

    // Line checkbox dropdown — uncheck all
    document.querySelectorAll('#dashFilterLinePanel input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    const lineToggle = document.querySelector('#lineDropdown .dropdown-toggle');
    if (lineToggle) lineToggle.childNodes[0].textContent = 'All Lines ';

    // Ship checkbox dropdown — uncheck all
    document.querySelectorAll('#dashFilterShipPanel input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    const shipToggle = document.querySelector('#shipDropdown .dropdown-toggle');
    if (shipToggle) shipToggle.childNodes[0].textContent = 'All Ships ';

    // Port checkbox dropdown — uncheck all
    document.querySelectorAll('#dashFilterPortPanel input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    const portToggle = document.querySelector('#portDropdown .dropdown-toggle');
    if (portToggle) portToggle.childNodes[0].textContent = 'All Ports ';

    // Nights checkbox dropdown — uncheck all
    document.querySelectorAll('#dashFilterNightsPanel input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    const nightsToggle = document.querySelector('#nightsDropdown .dropdown-toggle');
    if (nightsToggle) nightsToggle.childNodes[0].textContent = 'Any Nights ';

    // Month range picker — clear selection
    monthPickerStart = null;
    monthPickerEnd = null;
    const monthPanel = document.getElementById('dashFilterMonthPanel');
    if (monthPanel) {
        monthPanel.querySelectorAll('.month-cell').forEach(cell => {
            cell.classList.remove('selected', 'in-range', 'range-start', 'range-end');
        });
    }
    const monthToggle = document.querySelector('#monthPickerDropdown .dropdown-toggle');
    if (monthToggle) monthToggle.childNodes[0].textContent = 'Any Months ';

    applyDashboardFilters();
}

// ----------------------------------------------------------------------------------------------------
function cruiseLineIcon(line) {
    const logos = {
        Disney: `<img src="/img/disney-logo.svg" alt="Disney Cruise Line" class="line-logo" title="Disney Cruise Line">`,
        Norwegian: `<img src="/img/ncl-logo.svg" alt="Norwegian Cruise Line" class="line-logo" title="Norwegian Cruise Line">`,
        Celebrity: `<img src="/img/celebrity-logo.svg" alt="Celebrity Cruises" class="line-logo" title="Celebrity Cruises">`,
    };
    return logos[line] || `<span class="line-icon generic">${escHtml(line)}</span>`;
}

function populateCheckboxDropdown(panelId, options, label) {
    const panel = document.getElementById(panelId);
    panel.innerHTML = '';
    options.forEach(opt => {
        const item = document.createElement('label');
        item.className = 'dropdown-item';
        item.innerHTML = `<input type="checkbox" value="${escHtml(opt)}"> <span>${escHtml(opt)}</span>`;
        item.querySelector('input').addEventListener('change', () => {
            updateDropdownLabel(panelId, label);
            applyDashboardFilters();
        });
        panel.appendChild(item);
    });
}

function updateDropdownLabel(panelId, label) {
    const panel = document.getElementById(panelId);
    const checked = panel.querySelectorAll('input:checked');
    const btn = panel.parentElement.querySelector('.dropdown-toggle');
    if (checked.length === 0) {
        btn.innerHTML = `All ${label} <span class="dropdown-arrow">\u25BE</span>`;
    } else if (checked.length <= 2) {
        const names = Array.from(checked).map(cb => cb.value);
        btn.innerHTML = `${names.join(', ')} <span class="dropdown-arrow">\u25BE</span>`;
    } else {
        btn.innerHTML = `${checked.length} ${label} <span class="dropdown-arrow">\u25BE</span>`;
    }
}

function getCheckedValues(panelId) {
    const panel = document.getElementById(panelId);
    return Array.from(panel.querySelectorAll('input:checked')).map(cb => cb.value);
}

function initCheckboxDropdowns() {
    document.querySelectorAll('.checkbox-dropdown').forEach(dd => {
        const btn = dd.querySelector('.dropdown-toggle');
        const panel = dd.querySelector('.dropdown-panel');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close all other dropdowns
            document.querySelectorAll('.checkbox-dropdown.open').forEach(other => {
                if (other !== dd) other.classList.remove('open');
            });
            dd.classList.toggle('open');
        });
        panel.addEventListener('click', (e) => e.stopPropagation());
    });
    // Close on outside click
    document.addEventListener('click', () => {
        document.querySelectorAll('.checkbox-dropdown.open').forEach(dd => dd.classList.remove('open'));
    });
}

// ================================================================
//  MONTH RANGE PICKER
// ================================================================

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function initMonthPicker() {
    const panel = document.getElementById('dashFilterMonthPanel');
    if (!panel || !allCruises.length) return;

    // Determine year range from data
    const dates = allCruises.map(c => new Date(c.departureDate + 'T00:00:00'));
    const minYear = Math.min(...dates.map(d => d.getFullYear()));
    const maxYear = Math.max(...dates.map(d => d.getFullYear()));

    let html = '<div class="month-picker-grid">';
    for (let year = minYear; year <= maxYear; year++) {
        html += `<div class="month-picker-year">
            <div class="month-year-label">${year}</div>
            <div class="month-cells">`;
        for (let m = 0; m < 12; m++) {
            const key = year * 12 + m;
            html += `<div class="month-cell" data-month="${key}">${MONTH_NAMES[m]}</div>`;
        }
        html += `</div></div>`;
    }
    html += '</div>';
    panel.innerHTML = html;

    // Click handler
    panel.addEventListener('click', (e) => {
        const cell = e.target.closest('.month-cell');
        if (!cell) return;
        e.stopPropagation();
        const key = parseInt(cell.dataset.month);

        if (monthPickerStart === null) {
            // First click: set start
            monthPickerStart = key;
            monthPickerEnd = null;
        } else if (monthPickerEnd === null) {
            if (key === monthPickerStart) {
                // Click same month again: deselect
                monthPickerStart = null;
            } else {
                // Second click: set end (ensure start <= end)
                if (key < monthPickerStart) {
                    monthPickerEnd = monthPickerStart;
                    monthPickerStart = key;
                } else {
                    monthPickerEnd = key;
                }
            }
        } else {
            // Already have a range: reset and start new
            monthPickerStart = key;
            monthPickerEnd = null;
        }

        renderMonthPickerState(panel);
        updateMonthPickerLabel();
        applyDashboardFilters();
    });

    renderMonthPickerState(panel);
}

function renderMonthPickerState(panel) {
    panel.querySelectorAll('.month-cell').forEach(cell => {
        const key = parseInt(cell.dataset.month);
        cell.classList.remove('selected', 'in-range', 'range-start', 'range-end');

        if (monthPickerStart === null) return;

        const start = monthPickerStart;
        const end = monthPickerEnd !== null ? monthPickerEnd : monthPickerStart;

        if (key === start && key === end) {
            cell.classList.add('selected');
        } else if (key === start) {
            cell.classList.add('range-start');
        } else if (key === end) {
            cell.classList.add('range-end');
        } else if (key > start && key < end) {
            cell.classList.add('in-range');
        }
    });
}

function updateMonthPickerLabel() {
    const btn = document.querySelector('#monthPickerDropdown .dropdown-toggle');
    if (!btn) return;

    if (monthPickerStart === null) {
        btn.innerHTML = 'Any Months <span class="dropdown-arrow">\u25BE</span>';
        return;
    }

    const startYear = Math.floor(monthPickerStart / 12);
    const startMonth = monthPickerStart % 12;

    if (monthPickerEnd === null) {
        btn.innerHTML = `${MONTH_NAMES[startMonth]} ${startYear} <span class="dropdown-arrow">\u25BE</span>`;
    } else {
        const endYear = Math.floor(monthPickerEnd / 12);
        const endMonth = monthPickerEnd % 12;
        if (startYear === endYear) {
            btn.innerHTML = `${MONTH_NAMES[startMonth]}\u2013${MONTH_NAMES[endMonth]} ${startYear} <span class="dropdown-arrow">\u25BE</span>`;
        } else {
            btn.innerHTML = `${MONTH_NAMES[startMonth]} '${String(startYear).slice(2)}\u2013${MONTH_NAMES[endMonth]} '${String(endYear).slice(2)} <span class="dropdown-arrow">\u25BE</span>`;
        }
    }
}

function applyDashboardFilters() {
    const line = getCheckedValues('dashFilterLinePanel');
    const ship = getCheckedValues('dashFilterShipPanel');
    const port = getCheckedValues('dashFilterPortPanel');
    const suiteLevel = document.getElementById('dashFilterSuiteLevel').value;
    const nightsChecked = getCheckedValues('dashFilterNightsPanel');
    const maxPpd = parseInt(document.getElementById('dashFilterMaxPpd').value);
    const maxPpdMax = parseInt(document.getElementById('dashFilterMaxPpd').max);
    const maxTotal = parseInt(document.getElementById('dashFilterMaxTotal').value);
    const maxTotalMax = parseInt(document.getElementById('dashFilterMaxTotal').max);
    const hideSoldOut = document.getElementById('dashFilterHideSoldOut').checked;
    const kidsOnly = document.getElementById('dashFilterKidsOnly').checked;
    const shipWithinShip = document.getElementById('dashFilterShipWithinShip').checked;
    const showTransatlantic = document.getElementById('dashFilterTransatlantic').checked;

    let filtered = allCruises;

    const mode = getDiningMode();

    // Price sliders — use suite prices when in suite mode, balcony otherwise
    if (maxPpd < maxPpdMax) {
        if (mode === 'suite') {
            filtered = filtered.filter(c => {
                const ppd = (c.verifiedSuitePerDay && c.verifiedSuitePerDay > 0)
                    ? c.verifiedSuitePerDay : c.suitePerDay;
                return ppd && ppd > 0 && ppd <= maxPpd;
            });
        } else {
            filtered = filtered.filter(c => c.balconyPerDay && c.balconyPerDay > 0 && c.balconyPerDay <= maxPpd);
        }
    }
    if (maxTotal < maxTotalMax) {
        if (mode === 'suite') {
            filtered = filtered.filter(c => c.suitePrice && c.suitePrice > 0 && c.suitePrice <= maxTotal);
        } else {
            // Total for 2 guests
            filtered = filtered.filter(c => c.balconyPrice && c.balconyPrice > 0 && (c.balconyPrice * 2) <= maxTotal);
        }
    }

    // Hide sold out ??" exclude cruises with no valid price ($0 or null for both balcony and suite)
    if (hideSoldOut) {
        filtered = filtered.filter(hasValidPrice);
    }
    if (kidsOnly) {
        filtered = filtered.filter(c => c.hasKids);
    }
    if (shipWithinShip) {
        filtered = filtered.filter(c => c.suiteName && c.suiteName !== 'None' && c.suiteName !== 'N/A' && c.suiteName !== '?');
    }
    const flResOnly = document.getElementById('dashFilterFLResident').checked;
    if (flResOnly) {
        filtered = filtered.filter(c =>
            (c.flResBalconyPerDay && c.flResBalconyPerDay > 0 && c.balconyPerDay && c.flResBalconyPerDay < c.balconyPerDay) ||
            (c.flResSuitePerDay && c.flResSuitePerDay > 0 && c.suitePerDay && c.flResSuitePerDay < c.suitePerDay));
    }

    if (line.length > 0) filtered = filtered.filter(c => line.includes(c.cruiseLine));
    if (ship.length > 0) filtered = filtered.filter(c => ship.includes(c.shipName));
    if (port.length > 0) filtered = filtered.filter(c => port.includes(c.departurePort));
    if (suiteLevel) filtered = filtered.filter(c => c.suiteName === suiteLevel);

    // Schedule conflict filter
    const hideConflicts = document.getElementById('dashFilterNoConflicts').checked;
    if (hideConflicts && calendarEvents.length > 0) {
        filtered = filtered.filter(c => {
            const dep = new Date(c.departureDate + 'T00:00:00');
            const ret = new Date(dep);
            ret.setDate(ret.getDate() + (c.nights || 0));
            return !calendarEvents.some(evt => {
                const evtStart = new Date(evt.startDate + 'T00:00:00');
                const evtEnd = new Date(evt.endDate + 'T00:00:00');
                // Direct overlap check
                if (dep <= evtEnd && ret >= evtStart) return true;
                // 24-hour shift: can't depart the day after (recovery day)
                if (evt.title && evt.title.toLowerCase().includes('24 hour')) {
                    const dayAfter = new Date(evtEnd);
                    dayAfter.setDate(dayAfter.getDate() + 1);
                    if (dep.getTime() === dayAfter.getTime()) return true;
                }
                return false;
            });
        });
    }

    // Transatlantic filter ??" default OFF means we hide transatlantic cruises
    if (!showTransatlantic) {
        filtered = filtered.filter(c => !c.itinerary || !c.itinerary.toLowerCase().includes('transatlantic'));
    }

    if (nightsChecked.length > 0) {
        filtered = filtered.filter(c => {
            return nightsChecked.some(range => {
                if (range === '9+') return c.nights >= 9;
                const [min, max] = range.split('-').map(Number);
                return c.nights >= min && c.nights <= max;
            });
        });
    }

    // Compute value stars for filtered set
    computeValueStars(filtered);

    // Star filter - apply AFTER value computation
    const minStars = parseInt(document.getElementById('dashFilterStars').value || '0');
    if (minStars > 0) {
        filtered = filtered.filter(c => (c._valueStars || 0) >= minStars);
    }

    // Month range filter
    if (monthPickerStart !== null) {
        const mStart = monthPickerStart;
        const mEnd = monthPickerEnd !== null ? monthPickerEnd : monthPickerStart;
        filtered = filtered.filter(c => {
            const d = new Date(c.departureDate + 'T00:00:00');
            const m = d.getFullYear() * 12 + d.getMonth();
            return m >= mStart && m <= mEnd;
        });
    }

    // Sort based on order-by dropdown
    const orderBy = document.getElementById('dashOrderBy').value;
    const sortLabel = document.getElementById('dashSortLabel');
    if (orderBy === 'pricepd') {
        if (mode === 'suite') {
            filtered.sort((a, b) => (a.suitePerDay || 99999) - (b.suitePerDay || 99999));
            sortLabel.textContent = 'ranked by lowest suite price per day';
        } else {
            filtered.sort((a, b) => (a.balconyPerDay || 99999) - (b.balconyPerDay || 99999));
            sortLabel.textContent = 'ranked by lowest balcony price per day';
        }
    } else {
        const priceFn = mode === 'suite'
            ? (c => c.suitePerDay || 99999)
            : (c => c.balconyPerDay || 99999);
        filtered.sort((a, b) => (b._valueScoreRaw || 0) - (a._valueScoreRaw || 0) || priceFn(a) - priceFn(b));
        sortLabel.textContent = mode === 'suite' ? 'ranked by best suite value' : 'ranked by best balcony value';
    }

    document.getElementById('dashResultCount').textContent = `${filtered.length} options`;

    // Update stats from filtered results
    try { updateFilteredStats(filtered); } catch (e) { console.error('updateFilteredStats error:', e); }

    renderDashboardCards(filtered);
}

function updateFilteredStats(filtered) {
    const balPrices = filtered.map(c => c.balconyPerDay).filter(p => p && p > 0);
    const suitePrices = filtered.map(c => c.suitePerDay).filter(p => p && p > 0);
    document.getElementById('statSailings').textContent = filtered.length.toLocaleString();
    const ships = new Set(filtered.map(c => c.shipName));
    document.getElementById('statShips').textContent = ships.size;
    document.getElementById('statBalcony').textContent = balPrices.length > 0
        ? '$' + Math.round(Math.min(...balPrices)) : '\u2014';
    document.getElementById('statSuite').textContent = suitePrices.length > 0
        ? '$' + Math.round(Math.min(...suitePrices)) : '\u2014';
}

// ================================================================
//  VALUE SCORE & STAR RATING
// ================================================================

function computeValueStars(cruises) {
    // Read slider weights (0-100 each)
    const kidsW = parseInt(document.getElementById('weightKids')?.value ?? 30);
    const shipW = parseInt(document.getElementById('weightShip')?.value ?? 30);
    const diningW = parseInt(document.getElementById('weightDining')?.value ?? 30);
    const priceW = parseInt(document.getElementById('weightPrice')?.value ?? 35);
    const totalW = kidsW + shipW + diningW + priceW || 1; // avoid /0

    const mode = getDiningMode();

    // Compute effective price per day for each cruise based on mode
    function effectivePpd(c) {
        const bal = (c.balconyPerDay && c.balconyPerDay > 0) ? c.balconyPerDay : 0;
        if (mode === 'package') {
            return bal > 0 ? bal + (c.diningPackageCostPerDay || 0) : 0;
        } else if (mode === 'suite') {
            return (c.suitePerDay && c.suitePerDay > 0) ? c.suitePerDay : 0;
        }
        return bal; // main mode
    }

    // Gather effective prices for normalization
    const prices = cruises
        .map(c => effectivePpd(c))
        .filter(p => p && p > 0);

    if (prices.length === 0) {
        cruises.forEach(c => { c._valueStars = 3; c._valueScore = 50; });
        return;
    }

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || 1;

    cruises.forEach(c => {
        // Individual quality scores (0-100 each)
        const kidsScore = c.kidsScore || 50;
        const shipScore = c.shipScore || 50;
        const diningScore = getDynamicDiningScore(c, mode);

        // Price: lower = better -> 0-100
        const price = effectivePpd(c) || maxPrice;
        let priceScore = 100 * (1 - (price - minPrice) / priceRange);

        // Configurable per-line value bonus
        const bonusSuffix = (mode === 'suite') ? 'Suite' : 'Main';
        const lineName = c.cruiseLine;
        const bonusEl = document.getElementById('bonus' + lineName + bonusSuffix);
        const lineBonus = bonusEl ? parseInt(bonusEl.value) || 0 : 0;
        if (lineBonus !== 0) {
            priceScore = Math.max(0, Math.min(100, priceScore + lineBonus));
        }

        // Weighted score
        const valueScore = (kidsW * kidsScore + shipW * shipScore + diningW * diningScore + priceW * priceScore) / totalW;

        // Map to 0.5-5.0 stars
        let stars;
        if (valueScore >= 95) stars = 5.0;
        else if (valueScore >= 88) stars = 4.5;
        else if (valueScore >= 80) stars = 4.0;
        else if (valueScore >= 72) stars = 3.5;
        else if (valueScore >= 64) stars = 3.0;
        else if (valueScore >= 56) stars = 2.5;
        else if (valueScore >= 48) stars = 2.0;
        else if (valueScore >= 40) stars = 1.5;
        else stars = 1.0;
        c._valueStars = stars;
        c._valueScoreRaw = valueScore; // full precision for sorting
        c._valueScore = Math.round(valueScore); // rounded for display
    });
}

function renderStars(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
        if (rating >= i) {
            html += `<span class="value-star filled">\u2605</span>`;
        } else if (rating >= i - 0.5) {
            html += `<span class="value-star half">\u2605</span>`;
        } else {
            html += `<span class="value-star empty">\u2605</span>`;
        }
    }
    return html;
}

// ================================================================
//  DASHBOARD CARD RENDERING
// ================================================================

function fmtPpd(val) {
    if (!val || val <= 0) return '\u2014';
    return '$' + Math.round(val);
}

function fmtTotal(val) {
    if (!val || val <= 0) return '';
    return '$' + Math.round(val * 2).toLocaleString();
}

const CARDS_PER_PAGE = 25;
let _currentCardPage = 0;
let _currentFilteredCruises = [];

function renderDashboardCards(cruises) {
    const container = document.getElementById('dealsContainer');
    _currentFilteredCruises = cruises;
    _currentCardPage = 0;

    if (!cruises || cruises.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#x1F50D;</div><p>No cruises match your filters. Try adjusting.</p></div>';
        return;
    }

    const batch = cruises.slice(0, CARDS_PER_PAGE);
    container.innerHTML = batch.map((c, i) => renderSingleCard(c, i)).join('');
    _currentCardPage = 1;
    appendShowMoreButton(container, cruises);
}

function appendShowMoreButton(container, cruises) {
    // Remove old show-more
    const old = container.querySelector('.show-more-btn');
    if (old) old.remove();
    const shown = _currentCardPage * CARDS_PER_PAGE;
    if (shown < cruises.length) {
        const btn = document.createElement('button');
        btn.className = 'show-more-btn';
        btn.textContent = `Show More (${cruises.length - shown} remaining)`;
        btn.addEventListener('click', () => {
            const start = _currentCardPage * CARDS_PER_PAGE;
            const end = start + CARDS_PER_PAGE;
            const batch = cruises.slice(start, end);
            const frag = document.createDocumentFragment();
            const temp = document.createElement('div');
            temp.innerHTML = batch.map((c, i) => renderSingleCard(c, start + i)).join('');
            while (temp.firstChild) frag.appendChild(temp.firstChild);
            container.insertBefore(frag, btn);
            _currentCardPage++;
            if (_currentCardPage * CARDS_PER_PAGE >= cruises.length) {
                btn.remove();
            } else {
                btn.textContent = `Show More (${cruises.length - _currentCardPage * CARDS_PER_PAGE} remaining)`;
            }
        });
        container.appendChild(btn);
    }
}

// ── Booking URL builder ────────────────────────────────────────────────
const NCL_SHIP_CODES = {
    'Norwegian Aqua': 'AQUA', 'Norwegian Prima': 'PRIMA', 'Norwegian Viva': 'VIVA',
    'Norwegian Encore': 'ENCORE', 'Norwegian Bliss': 'BLISS', 'Norwegian Joy': 'JOY',
    'Norwegian Escape': 'ESCAPE', 'Norwegian Breakaway': 'BREAKAWAY',
    'Norwegian Getaway': 'GETAWAY', 'Norwegian Epic': 'EPIC',
    'Norwegian Gem': 'GEM', 'Norwegian Jade': 'JADE', 'Norwegian Pearl': 'PEARL',
    'Norwegian Dawn': 'DAWN', 'Norwegian Star': 'STAR', 'Norwegian Sun': 'SUN',
    'Norwegian Sky': 'SKY', 'Norwegian Spirit': 'SPIRIT',
    'Norwegian Luna': 'LUNA', 'Pride of America': 'POA',
};

const NCL_PORT_CODES = {
    'Miami': 'MIA', 'Port Canaveral': 'PCV', 'Tampa': 'TPA',
    'Jacksonville': 'JAX', 'New York': 'NYC', 'New Orleans': 'MSY',
    'Galveston': 'HOU', 'Seattle': 'SEA', 'San Juan': 'SJU',
    'Los Angeles': 'LAX', 'Honolulu': 'HNL', 'Boston': 'BOS',
};

function buildBookingUrl(c) {
    if (c.cruiseLine === 'Norwegian') {
        // Deep link if we have the itinerary code
        if (c.itineraryCode) {
            return `https://www.ncl.com/vacation-builder?itineraryCode=${encodeURIComponent(c.itineraryCode)}`;
        }
        // Fallback: filtered search by ship + port
        const shipCode = NCL_SHIP_CODES[c.shipName] || '';
        const portCode = NCL_PORT_CODES[c.departurePort] || '';
        const params = [];
        if (shipCode) params.push(`ship=${shipCode}`);
        if (portCode) params.push(`embPorts=${portCode}`);
        return `https://www.ncl.com/vacations${params.length ? '?' + params.join('&') : ''}`;
    }
    if (c.cruiseLine === 'Celebrity') {
        return 'https://www.celebritycruises.com/cruise-search';
    }
    if (c.cruiseLine === 'Disney') {
        return 'https://disneycruise.disney.go.com/cruises-destinations/list/';
    }
    return null;
}
function renderSingleCard(c, i) {
    const depDate = new Date(c.departureDate + 'T00:00:00');
    const retDate = new Date(depDate);
    retDate.setDate(retDate.getDate() + (c.nights || 0));
    const dateRange = formatShortDate(depDate) + ' \u2013 ' + formatShortDate(retDate) + ', ' + depDate.getFullYear();

    const suiteLabel = c.suiteName && c.suiteName !== '?' && c.suiteName !== 'None' ? c.suiteName : 'Suite';

    const portsList = c.ports ? c.ports.split(',').map(p => p.trim()).filter(p => p).join(' \u2192 ') : '';
    const cardId = `deal-${i}`;

    // FL Resident pricing helpers - only show when FL price is actually cheaper
    const hasFLBal = c.flResBalconyPerDay && c.flResBalconyPerDay > 0 && c.balconyPerDay && c.flResBalconyPerDay < c.balconyPerDay;
    const hasFLSuite = c.flResSuitePerDay && c.flResSuitePerDay > 0 && c.suitePerDay && c.flResSuitePerDay < c.suitePerDay;
    const hasFLRes = hasFLBal || hasFLSuite;

    // Booking link
    const bookingUrl = buildBookingUrl(c);
    const bookingLinkHtml = bookingUrl
        ? `<a href="${escAttr(bookingUrl)}" target="_blank" rel="noopener" class="booking-link" title="View on ${escAttr(c.cruiseLine)} website" onclick="event.stopPropagation()">&#x1F517;</a>`
        : '';

    // Build balcony price column
    let balconyPriceHtml;
    if (hasFLBal) {
        balconyPriceHtml = `<div class="price-col balcony fl-res-price">
                <span class="price-label">Balcony</span>
                <span class="price-ppd-regular">${fmtPpd(c.balconyPerDay)}<span class="ppd-suffix">/ppd</span></span>
                <span class="price-ppd fl-res">${fmtPpd(c.flResBalconyPerDay)}<span class="ppd-suffix">/ppd</span></span>
                <span class="price-total fl-res">${fmtTotal(c.flResBalconyPrice)}</span>
            </div>`;
    } else {
        balconyPriceHtml = `<div class="price-col balcony">
                <span class="price-label">Balcony</span>
                <span class="price-ppd">${fmtPpd(c.balconyPerDay)}<span class="ppd-suffix">/ppd</span></span>
                <span class="price-total">${fmtTotal(c.balconyPrice)}</span>
            </div>`;
    }

    // Build suite price column — show real scraped values
    let suitePriceHtml;
    if (hasFLSuite) {
        suitePriceHtml = `<div class="price-col suite fl-res-price">
                <span class="price-label">${suiteLabel}</span>
                <span class="price-ppd-regular">${fmtPpd(c.suitePerDay)}<span class="ppd-suffix">/ppd</span></span>
                <span class="price-ppd fl-res">${fmtPpd(c.flResSuitePerDay)}<span class="ppd-suffix">/ppd</span></span>
                <span class="price-total fl-res">${fmtTotal(c.flResSuitePrice)}</span>
            </div>`;
    } else {
        suitePriceHtml = `<div class="price-col suite">
                <span class="price-label">${suiteLabel}</span>
                <span class="price-ppd">${fmtPpd(c.suitePerDay)}<span class="ppd-suffix">/ppd</span></span>
                <span class="price-total">${fmtTotal(c.suitePrice)}</span>
            </div>`;
    }

    let flResBadge = '';
    if (hasFLRes) {
        let warning = '';
        if (c.flResScrapedAt) {
            const scrapeTime = new Date(c.flResScrapedAt.replace(' ', 'T'));
            const diffMs = new Date() - scrapeTime;
            const diffHours = diffMs / (1000 * 60 * 60);
            if (diffHours > 24) {
                const diffDays = Math.floor(diffHours / 24);
                warning = ` <span class="fl-res-stale-tag" title="FL Resident prices haven't successfully updated in ${diffDays} day(s). The database scraper cookie may be expired!" style="background:#ffc107; color:#000; padding:2px 6px; border-radius:4px; font-size:11px; margin-left:6px; font-weight:bold; cursor:help;">⚠️ Stale Data (${diffDays}d)</span>`;
            }
        }
        flResBadge = `<span class="fl-res-tag">\uD83C\uDFD6️ FL Resident</span>${warning}`;
    }
    // Dining ratings for all modes
    const mode = getDiningMode();
    const mainScore = getDynamicDiningScore(c, 'main') || '?';
    const pkgScore = getDynamicDiningScore(c, 'package') || '?';
    const suiteScore = getDynamicDiningScore(c, 'suite') || '?';

    const diningBadgesHtml = `
        <span class="dining-badges-group" title="Dining Quality (Main / Package / Suite)">
            <span class="rating-badge dining">🍽️${mainScore}</span>
            <span class="rating-badge dining">🎫${pkgScore}</span>
            <span class="rating-badge dining">👑${suiteScore}</span>
        </span>
    `;

    // Build mode-adjusted price column
    let modePriceHtml = '';
    if (mode === 'package' && c.diningPackageCostPerDay > 0 && c.balconyPerDay > 0) {
        const pkgPpd = c.balconyPerDay + c.diningPackageCostPerDay;
        const pkgTotal = c.balconyPrice ? c.balconyPrice + (c.diningPackageCostPerDay * (c.nights || 7) * 2) : null;
        modePriceHtml = `<div class="price-col package-price">
                <span class="price-label">🎫 +$${c.diningPackageCostPerDay}/ppd</span>
                <span class="price-ppd">${fmtPpd(pkgPpd)}<span class="ppd-suffix">/ppd</span></span>
                <span class="price-total">${fmtTotal(pkgTotal)}</span>
            </div>`;
    }

    return `<div class="deal-card${hasFLRes ? ' has-fl-res' : ''}" id="${cardId}" data-cruise-line="${escAttr(c.cruiseLine)}" data-ship-name="${escAttr(c.shipName)}" data-departure-date="${c.departureDate}">
            <div class="deal-card-main" onclick="toggleDealExpand('${cardId}')">
                <div class="deal-top-row">
                    ${cruiseLineIcon(c.cruiseLine)}
                    <div class="deal-ship-info">
                        <div class="deal-ship-name">${escHtml(c.shipName)} <span class="ship-class-tag">${escHtml(c.shipClass)}</span><span class="ship-year-tag">${c.yearBuilt ? c.yearBuilt : ''}${c.lastRenovated && c.lastRenovated !== 'None' ? ', rev ' + c.lastRenovated : ''}</span> <span class="rating-badge kids" title="Kids">🧒${c.kidsScore || '?'}</span> <span class="rating-badge ship" title="Ship">🚢${c.shipScore || '?'}</span> ${diningBadgesHtml}</div>
                        <div class="deal-dates">
                            <span class="date-range">&#x1F4C5; ${dateRange}</span>
                            <span class="deal-nights">${c.nights} nights</span>
                            <span class="deal-port">&#x1F4CD; ${escHtml(c.departurePort)}</span>
                        </div>
                    </div>
                    <div class="deal-value-stars">
                        <div class="stars-display">${renderStars(c._valueStars || 3)} <span class="value-pct">${c._valueScore || 50}</span></div>
                        <div class="value-label">Value</div>
                    </div>
                    <div class="deal-prices-row">
                        ${balconyPriceHtml}
                        ${modePriceHtml}
                        ${suitePriceHtml}
                    </div>
                </div>
                <div class="deal-meta-row">
                    <div class="deal-itinerary">${escHtml(c.itinerary)} ${bookingLinkHtml}</div>
                    <div class="deal-badges">
                        ${flResBadge}

                        ${suiteBadge(c.suiteName)}
                        ${kidsClubBadges(c.cruiseLine, c.departureDate, c.hasKids)}
                    </div>
                </div>
                <div class="deal-expand-hint">&#x25BE;</div>
            </div>
            <div class="deal-expanded" data-ports="${escAttr(portsList)}"></div>
        </div>`;
}

function toggleDealExpand(cardId) {
    const card = document.getElementById(cardId);
    const wasExpanded = card.classList.contains('expanded');
    card.classList.toggle('expanded');

    // Lazy-build expanded content on first open
    if (!wasExpanded) {
        const expandedEl = card.querySelector('.deal-expanded');
        if (expandedEl && !expandedEl.dataset.built) {
            expandedEl.dataset.built = 'true';
            const cruiseLine = card.dataset.cruiseLine;
            const shipName = card.dataset.shipName;
            const departureDate = card.dataset.departureDate;
            const ports = expandedEl.dataset.ports || '';

            const depDate = new Date(departureDate + 'T00:00:00');
            const retDate = new Date(depDate);
            const nights = parseInt(card.querySelector('.deal-nights')?.textContent) || 7;
            retDate.setDate(retDate.getDate() + nights);

            const c = _currentFilteredCruises.find(x => x.shipName === shipName && x.departureDate === departureDate);

            expandedEl.innerHTML = `<div class="deal-expanded-content">
                <div class="deal-expanded-left">
                    ${ports ? `<div class="ports-section">
                        <div class="ports-title">&#x1F5FA;&#xFE0F; Ports of Call</div>
                        <div class="ports-route">${escHtml(ports)}</div>
                    </div>` : ''}
                    <div class="chart-toggle-bar" id="chartToggle-${cardId}">
                        <button class="chart-toggle-btn" data-chart-mode="balcony">Balcony</button>
                        <button class="chart-toggle-btn" data-chart-mode="suite">Suite</button>
                    </div>
                    <div class="inline-chart-container" id="chart-${cardId}">
                        <canvas></canvas>
                    </div>
                </div>
                <div class="deal-expanded-right">
                    ${generateMiniCalendar(depDate, retDate)}
                </div>
            </div>
            <div id="dining-reports-${cardId}" class="deal-accordion">
                <div style="padding:15px; text-align:center; color:var(--text-muted); font-size:0.9rem;">
                    &#x23F3; Loading dining evaluation...
                </div>
            </div>`;

            // Load chart - default to current dining mode
            const chartContainer = document.getElementById('chart-' + cardId);
            const chartToggleBar = document.getElementById('chartToggle-' + cardId);
            if (chartContainer) {
                const defaultChartMode = getDiningMode() === 'suite' ? 'suite' : 'balcony';
                loadInlineChart(chartContainer, cruiseLine, shipName, departureDate, defaultChartMode);
                if (chartToggleBar) {
                    chartToggleBar.querySelectorAll('.chart-toggle-btn').forEach(btn => {
                        if (btn.dataset.chartMode === defaultChartMode) btn.classList.add('active');
                        btn.addEventListener('click', () => {
                            chartToggleBar.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            toggleChartDataset(chartContainer, btn.dataset.chartMode);
                        });
                    });
                }
            }

            // Load dining reports
            const diningContainer = document.getElementById('dining-reports-' + cardId);
            if (diningContainer && c) {
                loadDiningReportsHtml(diningContainer, c);
            }
        }
    }
}

async function loadInlineChart(container, cruiseLine, shipName, departureDate, defaultMode) {
    const canvas = container.querySelector('canvas');
    try {
        const data = await fetch(`/api/price-history/${encodeURIComponent(cruiseLine)}/${encodeURIComponent(shipName)}/${departureDate}`).then(r => r.json());
        if (!data || data.length === 0) {
            container.innerHTML = '<div class="chart-empty">No price history yet</div>';
            return;
        }
        const labels = data.map(d => {
            const dt = new Date(d.scrapedAt);
            return (dt.getMonth() + 1) + '/' + dt.getDate();
        });
        const balcony = data.map(d => d.balconyPerDay ?? null);
        const suite = data.map(d => d.suitePerDay ?? null);

        const showBalcony = defaultMode !== 'suite';
        const showSuite = defaultMode === 'suite';

        const chartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Balcony $/ppd', data: balcony, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.3, fill: true, pointRadius: 2, hidden: !showBalcony },
                    { label: 'Suite $/ppd', data: suite, borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)', tension: 0.3, fill: true, pointRadius: 2, hidden: !showSuite }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#888', callback: v => '$' + v.toLocaleString() + '/ppd' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
        // Store chart reference for toggling
        container._chartInstance = chartInstance;
    } catch (e) {
        container.innerHTML = '<div class="chart-empty">Failed to load chart</div>';
    }
}

function toggleChartDataset(container, mode) {
    const chart = container._chartInstance;
    if (!chart) return;
    chart.data.datasets[0].hidden = mode !== 'balcony'; // Balcony
    chart.data.datasets[1].hidden = mode !== 'suite';   // Suite
    chart.update();
}

// ================================================================
//  DINING REPORTS ACCORDION
// ================================================================

async function loadDiningReportsHtml(container, c) {
    try {
        const data = await fetch(`/api/restaurants/${encodeURIComponent(c.shipName)}`).then(r => r.json());
        if (!data || data.length === 0) {
            container.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-muted); font-size:0.9rem;">No detailed dining evaluation available for this ship.</div>';
            return;
        }

        const included = data.filter(r => r.type === 'Included' && r.score > 0).sort((a, b) => b.score - a.score);
        const specialty = data.filter(r => r.type.startsWith('Specialty') && r.score > 0).sort((a, b) => b.score - a.score);
        const suite = data.filter(r => r.type.startsWith('Suite') && r.score > 0).sort((a, b) => b.score - a.score);
        const unranked = data.filter(r => !r.score || r.score === 0).sort((a, b) => a.name.localeCompare(b.name));

        // Render individual restaurant groups
        const suiteHtml = suite.length > 0 ? renderRestaurantGroup('Suite-Exclusive Venues', suite) : '';
        const specialtyHtml = specialty.length > 0 ? renderRestaurantGroup('Specialty Venues', specialty) : '';
        const includedHtml = included.length > 0 ? renderRestaurantGroup('Main & Included Venues', included) : '';
        const unrankedHtml = unranked.length > 0 ? renderRestaurantGroup('Casual & Unranked Eateries', unranked, true) : '';

        // All Restaurants list combines them all
        const restHtml = suiteHtml + specialtyHtml + includedHtml + unrankedHtml;

        const mdrScoreStyle = getScoreColorStyle(c.mainDiningScore);
        const dynPkgScore = getDynamicDiningScore(c, 'package') || 0;
        const pkgScoreStyle = getScoreColorStyle(dynPkgScore);
        const suiteScoreStyle = getScoreColorStyle(c.suiteDiningScore);

        // Package Math Report Text
        const nights = c.nights || 7;
        let cap = 7;
        let penaltyText = '';
        if (c.cruiseLine === 'Disney') {
            cap = 2;
            const specNights = Math.min(nights, cap);
            const mdrNights = Math.max(0, nights - specNights);
            if (mdrNights > 0) {
                penaltyText = `This is a <strong>${nights}-night</strong> sailing. Disney strictly limits specialty dining, allocating roughly ${cap} premium nights per sailing. Since your sailing exceeds the cap by ${mdrNights} nights, we mathematically force the remaining ${mdrNights} nights to fall back to your ship's lower Main Dining Room score, yielding a lower blended package rating.`;
            } else {
                penaltyText = `This is a <strong>${nights}-night</strong> sailing. Disney strictly limits specialty dining to roughly ${cap} premium nights per sailing. Since your sailing does not exceed the ${cap}-night cap, no backup Main Dining penalty applies and you get the true specialty quality for your entire trip.`;
            }
        } else if (c.cruiseLine === 'Celebrity' || c.cruiseLine === 'Norwegian') {
            cap = c.cruiseLine === 'Celebrity' ? 4 : 7;
            const fatigueNights = Math.max(0, nights - cap);
            if (fatigueNights > 0) {
                penaltyText = `This is a <strong>${nights}-night</strong> sailing. The specialty dining 'Menu Fatigue' cap for ${c.cruiseLine} is ${cap} nights before guests start repeating restaurants. Since your sailing extends ${fatigueNights} nights beyond the cap, a 15-point quality penalty is applied to the repeated visits, dragging down the blended package rating.`;
            } else {
                penaltyText = `This is a <strong>${nights}-night</strong> sailing. The specialty dining 'Menu Fatigue' cap for ${c.cruiseLine} is ${cap} nights. Since your sailing length is within the cap, no 'Menu Fatigue' penalty is applied to your score.`;
            }
        } else {
            const fatigueNights = Math.max(0, nights - cap);
            if (fatigueNights > 0) {
                penaltyText = `This is a <strong>${nights}-night</strong> sailing. The 'Menu Fatigue' cap is ${cap} nights. Since your sailing extends ${fatigueNights} nights beyond the cap, a 15-point penalty is applied to repeated visits.`;
            } else {
                penaltyText = `This is a <strong>${nights}-night</strong> sailing. The 'Menu Fatigue' cap is ${cap} nights. Since your sailing is within the cap, no penalty is applied.`;
            }
        }

        let packageCostNote = c.diningPackageCostPerDay > 0 ? `<br/><br/><em>Note: The total assumed cost for this package is roughly $${Math.round(c.diningPackageCostPerDay)}/ppd.</em>` : '';

        // Generate Accordion HTML
        container.innerHTML = `
            <div class="accordion-item">
                <div class="accordion-header" onclick="this.parentElement.classList.toggle('active')">
                    <div class="accordion-title"><span class="accordion-icon">&#x1F451;</span> Suite Dining Report</div>
                    <span class="accordion-toggle">&#x25BC;</span>
                </div>
                <div class="accordion-content">
                    ${c.suiteDiningScore > 0 && suite.length > 0 ? `
                        <div class="dining-score-callout" ${suiteScoreStyle}>Score: ${c.suiteDiningScore}</div>
                        <div class="dining-report-text">
                            This score reflects the exclusive "ship-within-a-ship" restaurant dedicated to suite guests. These venues typically circumvent the mass-banquet penalty entirely, offering an intimate, made-to-order kitchen resulting in significantly higher quality food.
                        </div>
                        <div style="margin-top: 15px;">
                            ${suiteHtml}
                        </div>
                    ` : `
                        <div class="dining-report-text">
                            This ship does not feature a dedicated suite-exclusive restaurant. Guests in suites will dine in the standard Main Dining or Specialty venues. Therefore, the suite dining score defaults to the Main Dining base score.
                        </div>
                    `}
                </div>
            </div>

            <div class="accordion-item">
                <div class="accordion-header" onclick="this.parentElement.classList.toggle('active')">
                    <div class="accordion-title"><span class="accordion-icon">&#x1F3AB;</span> Package Dining Report</div>
                    <span class="accordion-toggle">&#x25BC;</span>
                </div>
                <div class="accordion-content">
                    <div class="dining-score-callout" ${pkgScoreStyle}>Blended Score: ${dynPkgScore}</div>
                    <div class="dining-report-text">
                        This score reflects the theoretical max quality if purchasing the unlimited/maximum specialty dining package. It evaluates the top paid venues onboard.
                        <br/><br/>
                        <strong>Menu Fatigue Math:</strong> ${penaltyText}
                        ${packageCostNote}
                    </div>
                    ${specialtyHtml ? `<div style="margin-top: 15px;">${specialtyHtml}</div>` : ''}
                </div>
            </div>

            <div class="accordion-item">
                <div class="accordion-header" onclick="this.parentElement.classList.toggle('active')">
                    <div class="accordion-title"><span class="accordion-icon">&#x1F37D;&#xFE0F;</span> Main Dining Report</div>
                    <span class="accordion-toggle">&#x25BC;</span>
                </div>
                <div class="accordion-content">
                    <div class="dining-score-callout" ${mdrScoreStyle}>Score: ${c.mainDiningScore || 0}</div>
                    <div class="dining-report-text">
                        This score reflects the baseline included dining experience available at no extra cost. It is primarily driven by the execution quality of the highest-scoring complimentary sit-down venue on board. Lower scores typically indicate high "banquet penalties" \u2014 lukewarm plates and lowest-common-denominator seasoning due to mass batch-cooking for thousands simultaneously.
                    </div>
                    ${includedHtml ? `<div style="margin-top: 15px;">${includedHtml}</div>` : ''}
                </div>
            </div>

            <div class="accordion-item">
                <div class="accordion-header" onclick="this.parentElement.classList.toggle('active')">
                    <div class="accordion-title"><span class="accordion-icon">&#x1F37D;&#xFE0F;</span> All Restaurants onboard ${escHtml(c.shipName)}</div>
                    <span class="accordion-toggle">&#x25BC;</span>
                </div>
                <div class="accordion-content">
                    ${restHtml}
                </div>
            </div>
        `;

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="padding:15px; text-align:center; color:var(--score-red); font-size:0.9rem;">Failed to load dining reports.</div>';
    }
}

function renderRestaurantGroup(title, list, isUnranked = false) {
    if (!list || list.length === 0) return '';
    return `<div class="restaurant-list-group">
        <h5>${title}</h5>
        <div class="restaurant-grid">
            ${list.map(r => `
                <div class="restaurant-card ${isUnranked ? 'unranked' : ''}">
                    <div class="restaurant-card-header">
                        <div class="restaurant-name-block">
                            <div class="restaurant-name">${escHtml(r.name)}</div>
                            <div class="restaurant-cuisine">${escHtml(r.type)} • ${escHtml(r.cuisine)}</div>
                        </div>
                        ${!isUnranked ? `<div class="restaurant-score-badge" ${getScoreColorStyle(r.score)}>${r.score}</div>` : ''}
                    </div>
                    ${!isUnranked && r.why ? `<div class="restaurant-why">${escHtml(r.why)}</div>` : ''}
                </div>
            `).join('')}
        </div>
    </div>`;
}

function getScoreColorStyle(score) {
    if (!score || score <= 0) return 'style="color: var(--text-muted);"';

    // clamp score between 50 and 95
    const minScore = 50;
    const maxScore = 95;
    const clamped = Math.max(minScore, Math.min(maxScore, score));

    // Map to hue: 0 is red, 120 is green
    const hue = ((clamped - minScore) / (maxScore - minScore)) * 120;

    // For text on dark background, lightness should be around 60%
    return `style="color: hsl(${hue}, 85%, 60%);"`;
}

// ================================================================
//  MINI CALENDAR
// ================================================================

function generateMiniCalendar(depDate, retDate) {
    // Determine which months to show
    const months = [];
    const startMonth = new Date(depDate.getFullYear(), depDate.getMonth(), 1);
    const endMonth = new Date(retDate.getFullYear(), retDate.getMonth(), 1);

    let cursor = new Date(startMonth);
    while (cursor <= endMonth) {
        months.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return `<div class="mini-cal-container">${months.map(m => renderMiniMonth(m, depDate, retDate)).join('')}</div>`;
}

function renderMiniMonth(monthDate, depDate, retDate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const monthName = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    // First day of month (0=Sun, 1=Mon, ...) ??" adjust for Mon-start
    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1; // Mon=0 offset
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const dayHeaders = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    let html = `<div class="mini-cal">
        <div class="mini-cal-month">${monthName}</div>
        <div class="mini-cal-grid">
            ${dayHeaders.map(d => `<span class="mini-cal-header">${d}</span>`).join('')}`;

    // Empty cells for offset
    for (let i = 0; i < offset; i++) {
        html += '<span class="mini-cal-day empty"></span>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const thisDate = new Date(year, month, day);
        const isInRange = thisDate >= depDate && thisDate <= retDate;
        const isDep = thisDate.getTime() === depDate.getTime();
        const isRet = thisDate.getTime() === retDate.getTime();

        let cls = 'mini-cal-day';
        if (isInRange) cls += ' highlighted';
        if (isDep) cls += ' dep';
        if (isRet) cls += ' ret';

        html += `<span class="${cls}">${day}</span>`;
    }

    html += '</div></div>';
    return html;
}

// ================================================================
//  ALL CRUISES TABLE
// ================================================================

function initCruiseFilters() {
    ['filterLine', 'filterSuiteLevel', 'filterNights'].forEach(id => {
        document.getElementById(id).addEventListener('change', applyFilters);
    });
    ['filterShip', 'filterPort', 'filterMaxPrice'].forEach(id => {
        document.getElementById(id).addEventListener('input', debounce(applyFilters, 300));
    });
    ['filterHideSoldOut', 'filterShipWithinShip'].forEach(id => {
        document.getElementById(id).addEventListener('change', applyFilters);
    });
    document.getElementById('filterShipSuiteLevel').addEventListener('change', applyShipFilters);
    // Note: filterShipLinePanel is handled generically by initCheckboxDropdowns for 'change' events across inputs
}

function applyFilters() {
    const line = document.getElementById('filterLine').value;
    const ship = document.getElementById('filterShip').value.toLowerCase();
    const port = document.getElementById('filterPort').value.toLowerCase();
    const suiteLevel = document.getElementById('filterSuiteLevel').value;
    const nights = document.getElementById('filterNights').value;
    const maxPrice = parseFloat(document.getElementById('filterMaxPrice').value) || 0;
    const hideSoldOut = document.getElementById('filterHideSoldOut').checked;
    const shipWithinShip = document.getElementById('filterShipWithinShip').checked;

    let filtered = allCruises;

    if (hideSoldOut) {
        filtered = filtered.filter(hasValidPrice);
    }
    if (line) filtered = filtered.filter(c => c.cruiseLine === line);
    if (ship) filtered = filtered.filter(c => c.shipName.toLowerCase().includes(ship));
    if (port) filtered = filtered.filter(c => c.departurePort.toLowerCase().includes(port));
    if (suiteLevel) filtered = filtered.filter(c => c.suiteName === suiteLevel);

    if (nights) {
        if (nights === '8+') {
            filtered = filtered.filter(c => c.nights >= 8);
        } else {
            const [min, max] = nights.split('-').map(Number);
            filtered = filtered.filter(c => c.nights >= min && c.nights <= max);
        }
    }
    if (maxPrice > 0) {
        filtered = filtered.filter(c => c.balconyPerDay && c.balconyPerDay > 0 && c.balconyPerDay <= maxPrice);
    }
    if (shipWithinShip) {
        filtered = filtered.filter(c => c.suiteName && c.suiteName !== 'None' && c.suiteName !== 'N/A' && c.suiteName !== '?');
    }

    renderCruises(filtered);
}

function initTableSort() {
    document.querySelectorAll('.data-table thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (currentSort.field === field) {
                currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort = { field, dir: 'asc' };
            }
            document.querySelectorAll('.data-table thead th').forEach(t => t.classList.remove('sorted'));
            th.classList.add('sorted');
            th.querySelector('.sort-icon').textContent = currentSort.dir === 'asc' ? '\u25B2' : '\u25BC';
            applyFilters();
        });
    });
}

function renderCruises(cruises) {
    const sorted = [...cruises].sort((a, b) => {
        const dir = currentSort.dir === 'asc' ? 1 : -1;
        switch (currentSort.field) {
            case 'line': return dir * a.cruiseLine.localeCompare(b.cruiseLine);
            case 'ship': return dir * a.shipName.localeCompare(b.shipName);
            case 'departureDate': return dir * a.departureDate.localeCompare(b.departureDate);
            case 'nights': return dir * ((a.nights || 0) - (b.nights || 0));
            case 'balcony': return dir * ((a.balconyPerDay || 99999) - (b.balconyPerDay || 99999));
            case 'suite': return dir * ((a.suitePerDay || 99999) - (b.suitePerDay || 99999));
            default: return 0;
        }
    });

    const tbody = document.getElementById('cruiseTableBody');
    document.getElementById('resultCount').textContent = `${sorted.length} sailings`;

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="empty-state"><div class="empty-icon">�Y"�</div><p>No results match your filters</p></td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(c => {
        const bClass = priceClass(c.balconyPerDay, c.cruiseLine, 'balcony');
        const sClass = priceClass(c.suitePerDay, c.cruiseLine, 'suite');

        const depDate = new Date(c.departureDate + 'T00:00:00');
        const retDate = new Date(depDate);
        retDate.setDate(retDate.getDate() + (c.nights || 0));
        const dateStr = formatShortDate(depDate) + ' \u2013 ' + formatShortDate(retDate);

        return `<tr>
            <td><span class="cell-line"><span class="line-dot ${c.cruiseLine.toLowerCase()}"></span>${escHtml(c.cruiseLine)}</span></td>
            <td class="cell-ship">${escHtml(c.shipName)}</td>
            <td>${escHtml(c.shipClass)}</td>
            <td>${dateStr}</td>
            <td>${escHtml(c.departurePort)}</td>
            <td>${c.nights}</td>
            <td>${escHtml(truncate(c.itinerary, 30))}</td>
            <td class="price-cell ${bClass}">
                ${c.balconyPrice ? '$' + Math.round(c.balconyPrice * 2).toLocaleString() : '<span class="na">N/A</span>'}
                ${c.balconyPerDay ? `<span class="ppd">$${Math.round(c.balconyPerDay)}/ppd</span>` : ''}
            </td>
            <td class="price-cell ${sClass}">
                ${c.suitePrice ? '$' + Math.round(c.suitePrice * 2).toLocaleString() : '<span class="na">N/A</span>'}
                ${c.suitePerDay ? `<span class="ppd">$${Math.round(c.suitePerDay)}/ppd</span>` : ''}
            </td>
            <td>${suiteBadge(c.suiteName)}</td>
            <td class="kids-badge">${c.hasKids ? '?o.' : '?>"'}</td>
            <td><button class="btn-chart" onclick="showPriceHistory('${escAttr(c.cruiseLine)}','${escAttr(c.shipName)}','${c.departureDate}')">�Y"^</button></td>
        </tr>`;
    }).join('');
}

function priceClass(ppd, line, type) {
    if (!ppd) return 'na';
    const thresholds = {
        Disney: { balcony: 300, suite: 500 },
        Norwegian: { balcony: 150, suite: 250 },
    };
    const t = thresholds[line]?.[type] || 999;
    return ppd <= t ? 'good' : 'ok';
}

// ================================================================
//  SHIP REFERENCE CARDS
// ================================================================

function applyShipFilters() {
    const line = getCheckedValues('filterShipLinePanel');
    const haven = document.getElementById('filterShipSuiteLevel').value;
    let filtered = allShips;
    if (line.length > 0) filtered = filtered.filter(s => line.includes(s.cruiseLine));
    if (haven) filtered = filtered.filter(s => s.suiteName === haven);
    renderShips(filtered);
}

const _diningCache = {};
async function loadDiningDetails(detailsEl, shipName) {
    if (!detailsEl.open) return; // Only load when opening
    const contentDiv = detailsEl.querySelector('.dining-results');
    if (contentDiv.dataset.loaded) return; // Already loaded

    if (_diningCache[shipName]) {
        renderDiningDetails(contentDiv, _diningCache[shipName]);
        return;
    }

    try {
        const res = await fetch(`/api/restaurants/${encodeURIComponent(shipName)}`);
        const data = await res.json();
        _diningCache[shipName] = data;
        renderDiningDetails(contentDiv, data);
    } catch (err) {
        contentDiv.innerHTML = '<span class="error">Failed to load dining data.</span>';
    }
}

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function renderDiningDetails(container, restaurants) {
    container.dataset.loaded = 'true';
    if (!restaurants || restaurants.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 10px; font-size: 0.9em; opacity: 0.7;">No dining evaluations available.</div>';
        return;
    }

    // Sort by score descending
    const sorted = [...restaurants].sort((a, b) => b.score - a.score);

    container.innerHTML = sorted.map(r => `
        <div class="dining-venue">
            <div class="dining-venue-header">
                <strong>${escHtml(r.name)}</strong>
                <input type="number" id="rest-score-${r.id}" class="dining-score dining-score-edit ${r.score >= 90 ? 'excellent' : r.score >= 80 ? 'good' : r.score >= 70 ? 'avg' : 'poor'}" min="0" max="100" value="${r.score}" onchange="updateRestaurantScore(${r.id}, '${escAttr(r.shipName)}')">
            </div>
            <div class="dining-meta">
                <span class="dining-type">${escHtml(r.type)}</span> &bull; 
                <span class="dining-cuisine">${escHtml(r.cuisine)}</span>
            </div>
            <div class="dining-why">
                <textarea id="rest-why-${r.id}" class="dining-why-edit" rows="1" oninput="autoResizeTextarea(this)" onchange="updateRestaurantScore(${r.id}, '${escAttr(r.shipName)}')">${escHtml(r.why)}</textarea>
            </div>
        </div>
    `).join('');

    // Trigger auto-resize once rendered
    setTimeout(() => {
        container.querySelectorAll('.dining-why-edit').forEach(ta => autoResizeTextarea(ta));
    }, 0);
}

function renderShips(ships) {
    const grid = document.getElementById('shipsGrid');
    if (!ships || ships.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-icon">&#x1F6A2;</div><p>No ships match filters</p></div>';
        return;
    }
    grid.innerHTML = ships.map(s => {
        return `
        <div class="ship-card">
            <div class="ship-card-header">
                <div>
                    <h3>${escHtml(s.shipName)}</h3>
                    <span class="ship-line">${escHtml(s.cruiseLine)}</span>
                </div>
                ${suiteBadge(s.suiteName)}
            </div>
            <div class="ship-ratings-row">
                <div class="ship-rating-edit">
                    <label class="rating-edit-label">🧒 Kids</label>
                    <input type="number" class="rating-input num" min="0" max="100" value="${s.kidsScore || 0}" onchange="updateShipRating('${escAttr(s.shipName)}', 'kidsScore', parseInt(this.value, 10))">
                </div>
                <div class="ship-rating-edit">
                    <label class="rating-edit-label">🚢 Ship</label>
                    <input type="number" class="rating-input num" min="0" max="100" value="${s.shipScore || 0}" onchange="updateShipRating('${escAttr(s.shipName)}', 'shipScore', parseInt(this.value, 10))">
                </div>
                <div class="ship-rating-static">
                    <label class="rating-edit-label">🍽️ Dining (M|P|S)</label>
                    <div class="multi-rating-badges">
                        <span class="grade-badge" title="Main Dining">${s.mainDiningScore || '?'}</span>
                        <span class="grade-badge" title="Package Dining">${s.packageDiningScore || '?'}</span>
                        <span class="grade-badge" title="Suite Dining">${s.suiteDiningScore || '?'}</span>
                    </div>
                </div>
            </div>
            <div class="ship-specs">
                <div class="ship-spec"><span class="spec-label">Class</span><span class="spec-value">${escHtml(s.shipClass)}</span></div>
                <div class="ship-spec"><span class="spec-label">Built</span><span class="spec-value">${s.yearBuilt}</span></div>
                <div class="ship-spec"><span class="spec-label">Renovated</span><span class="spec-value">${escHtml(s.lastRenovated)}</span></div>
                <div class="ship-spec"><span class="spec-label">Tonnage</span><span class="spec-value">${s.grossTonnage.toLocaleString()} GT</span></div>
                <div class="ship-spec"><span class="spec-label">Capacity</span><span class="spec-value">${s.passengerCapacity.toLocaleString()} pax</span></div>
                <div class="ship-spec"><span class="spec-label">Suite Level</span><span class="spec-value">${escHtml(s.suiteName)}</span></div>
                <div class="ship-spec"><span class="spec-label">Kids</span><span class="spec-value">${s.hasKidsArea ? '\u2705' : '\u274C None'}</span></div>
            </div>
            ${s.hasKidsArea ? `<div class="ship-tags"><span class="ship-tag kids">&#x1F476; ${escHtml(s.kidsProgram)}</span></div>` : ''}
            <div class="ship-tags"><span class="ship-tag water">&#x1F3CA; ${escHtml(s.waterFeatures)}</span></div>
            <div class="ship-notes">${escHtml(s.familyNotes)}</div>
            <details class="dining-details" ontoggle="loadDiningDetails(this, '${escAttr(s.shipName)}')">
                <summary>🍽️ View Dining Evaluations</summary>
                <div class="dining-results">
                    <div class="loading" style="padding:10px;"><div class="spinner"></div> Loading...</div>
                </div>
            </details>
        </div>
    `}).join('');
}

async function updateShipRating(shipName, ratingField, value) {
    try {
        const body = {};
        body[ratingField] = value;
        await fetch(`/api/ship-rating/${encodeURIComponent(shipName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        // Update local cruise data so value stars recalculate
        if (allCruises) {
            allCruises.forEach(c => {
                if (c.shipName === shipName) c[ratingField] = value;
            });
            applyDashboardFilters();
        }
        // Update local ship data
        if (allShips) {
            allShips.forEach(s => {
                if (s.shipName === shipName) s[ratingField] = value;
            });
        }
    } catch (e) {
        console.error('Failed to update rating:', e);
    }
}

async function updateRestaurantScore(id, shipName) {
    const scoreVal = document.getElementById(`rest-score-${id}`).value;
    const whyVal = document.getElementById(`rest-why-${id}`).value;
    try {
        await fetch(`/api/restaurants/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score: parseInt(scoreVal, 10), why: whyVal })
        });

        // Clear dining cache for this ship to force a reload next time it's opened
        delete _diningCache[shipName];

        // Reload dashboard to get new aggregated sizes
        const [cruises, ships] = await Promise.all([
            fetch('/api/cruises').then(r => r.json()),
            fetch('/api/ships').then(r => r.json())
        ]);
        allCruises = cruises;
        allShips = ships;
        applyDashboardFilters();
        applyShipFilters();
    } catch (e) {
        console.error('Failed to update restaurant score:', e);
    }
}

// ================================================================
//  PRICE HISTORY MODAL + CHART
// ================================================================

function initModal() {
    const closeBtn = document.getElementById('modalClose');
    const priceMod = document.getElementById('priceModal');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    if (priceMod) {
        priceMod.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

function closeModal() {
    document.getElementById('priceModal').classList.remove('active');
    if (priceChart) { priceChart.destroy(); priceChart = null; }
}

async function showPriceHistory(cruiseLine, shipName, departureDate) {
    const modal = document.getElementById('priceModal');
    document.getElementById('modalTitle').textContent = `${shipName} \u2014 Price History`;
    document.getElementById('modalSubtitle').textContent = `${cruiseLine} · Departing ${formatDateStr(departureDate)}`;
    modal.classList.add('active');

    try {
        const data = await fetch(`/api/price-history/${encodeURIComponent(cruiseLine)}/${encodeURIComponent(shipName)}/${departureDate}`).then(r => r.json());

        if (!data || data.length === 0) {
            document.getElementById('modalSubtitle').textContent += ' · No price history yet';
            return;
        }

        const ctx = document.getElementById('priceChart').getContext('2d');
        if (priceChart) priceChart.destroy();

        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => d.scrapedAt),
                datasets: [
                    {
                        label: 'Balcony $/ppd',
                        data: data.map(d => d.balconyPerDay),
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        borderWidth: 2, tension: 0.3, fill: true,
                        pointRadius: 4, pointHoverRadius: 6,
                    },
                    {
                        label: 'Suite $/ppd',
                        data: data.map(d => d.suitePerDay),
                        borderColor: '#a78bfa',
                        backgroundColor: 'rgba(167, 139, 250, 0.1)',
                        borderWidth: 2, tension: 0.3, fill: true,
                        pointRadius: 4, pointHoverRadius: 6,
                    },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } },
                    tooltip: {
                        backgroundColor: '#1e293b', titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
                        callbacks: { label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y?.toFixed(0) || 'N/A'}` }
                    }
                },
                scales: {
                    x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { ticks: { color: '#64748b', callback: v => '$' + v, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
                }
            }
        });
    } catch (err) {
        console.error('Failed to load price history:', err);
    }
}

// ================================================================
//  HELPERS
// ================================================================

function suiteBadge(name) {
    if (!name || name === 'None' || name === '?' || name === 'N/A') return '';
    const cls = name.toLowerCase().replace(/[\s']/g, '');
    return `<span class="suite-badge ${cls}">${escHtml(name)}</span>`;
}

function formatShortDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateStr(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(d) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '\u2026' : str;
}

function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escAttr(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}


// ================================================================
//  FAMILY CALENDAR
// ================================================================

let calEditingId = null;

function initCalendar() {
    document.getElementById('calPrev').addEventListener('click', () => {
        calViewMonth--;
        if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
        renderCalendar();
    });
    document.getElementById('calNext').addEventListener('click', () => {
        calViewMonth++;
        if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
        renderCalendar();
    });
    document.getElementById('calToday').addEventListener('click', () => {
        calViewYear = new Date().getFullYear();
        calViewMonth = new Date().getMonth();
        renderCalendar();
    });
    document.getElementById('calAddBtn').addEventListener('click', saveCalendarEvent);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.cal-popup') && !e.target.closest('.cal-event-pill')) {
            closeCalPopup();
        }
    });
}

function renderCalendar() {
    const grid = document.getElementById('calGrid');
    const headers = grid.querySelectorAll('.cal-day-header');
    grid.innerHTML = '';
    headers.forEach(h => grid.appendChild(h));

    const titleEl = document.getElementById('calTitle');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    titleEl.textContent = `${monthNames[calViewMonth]} ${calViewYear}`;

    const firstDay = new Date(calViewYear, calViewMonth, 1);
    const lastDay = new Date(calViewYear, calViewMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    for (let i = 0; i < startDayOfWeek; i++) {
        const cell = document.createElement('div');
        cell.className = 'cal-day empty';
        grid.appendChild(cell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        cell.className = 'cal-day';
        if (dateStr === todayStr) cell.classList.add('today');
        cell.dataset.date = dateStr;

        cell.addEventListener('click', (e) => {
            if (e.target.closest('.cal-event-pill')) return;
            calStartAdd(dateStr);
        });

        const dayNum = document.createElement('div');
        dayNum.className = 'cal-day-num';
        dayNum.textContent = day;
        cell.appendChild(dayNum);

        calendarEvents.forEach(evt => {
            if (evt.startDate <= dateStr && evt.endDate >= dateStr) {
                const pill = document.createElement('div');
                pill.className = `cal-event-pill ${evt.type}`;
                pill.textContent = evt.title;
                pill.title = 'Click to edit';
                pill.dataset.eventId = evt.id;
                pill.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openCalPopup(evt, pill);
                });
                cell.appendChild(pill);
            }
        });

        grid.appendChild(cell);
    }
    renderEventList();
}

function calStartAdd(dateStr) {
    closeCalPopup();
    document.getElementById('calEventStart').value = dateStr;
    document.getElementById('calEventEnd').value = dateStr;
    document.getElementById('calEventTitle').value = '';
    document.getElementById('calEventTitle').focus();
    document.querySelector('.cal-add-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openCalPopup(evt, anchorEl) {
    closeCalPopup();
    const popup = document.createElement('div');
    popup.className = 'cal-popup';
    popup.innerHTML = `
        <div class="cal-popup-header">
            <span class="cal-popup-type-dot ${evt.type}"></span>
            <strong>Edit Event</strong>
            <button class="cal-popup-close" onclick="closeCalPopup()">&#x2715;</button>
        </div>
        <div class="cal-popup-body">
            <label>Type</label>
            <select id="calPopupType" class="filter-select">
                <option value="work" ${evt.type === 'work' ? 'selected' : ''}>Amy's Work</option>
                <option value="travel" ${evt.type === 'travel' ? 'selected' : ''}>Travel</option>
            </select>
            <label>Title</label>
            <input type="text" id="calPopupTitle" class="filter-input" value="${escAttr(evt.title)}">
            <label>Start</label>
            <input type="date" id="calPopupStart" class="filter-input" value="${evt.startDate}">
            <label>End</label>
            <input type="date" id="calPopupEnd" class="filter-input" value="${evt.endDate}">
        </div>
        <div class="cal-popup-actions">
            <button class="cal-popup-save" onclick="updateCalendarEvent('${evt.id}')">Save</button>
            <button class="cal-popup-delete" onclick="deleteCalendarEvent('${evt.id}')">Delete</button>
        </div>
    `;
    document.body.appendChild(popup);

    const rect = anchorEl.getBoundingClientRect();
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 4;
    if (left + 260 > window.innerWidth) left = window.innerWidth - 276;
    if (left < 8) left = 8;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

function closeCalPopup() {
    document.querySelectorAll('.cal-popup').forEach(p => p.remove());
}

async function updateCalendarEvent(id) {
    const type = document.getElementById('calPopupType').value;
    const title = document.getElementById('calPopupTitle').value.trim();
    const startDate = document.getElementById('calPopupStart').value;
    const endDate = document.getElementById('calPopupEnd').value || startDate;
    if (!title || !startDate) return;
    try {
        const res = await fetch(`/api/calendar-events/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, startDate, endDate, type, title })
        });
        const updated = await res.json();
        const idx = calendarEvents.findIndex(e => e.id === id);
        if (idx >= 0) calendarEvents[idx] = updated;
        closeCalPopup();
        renderCalendar();
        if (document.getElementById('dashFilterNoConflicts').checked) applyDashboardFilters();
    } catch (err) { console.error('Failed to update event:', err); }
}

function renderEventList() {
    const list = document.getElementById('calEventList');
    if (calendarEvents.length === 0) {
        list.innerHTML = '<div class="cal-empty">No events yet. Click a day on the calendar to add one.</div>';
        return;
    }
    const sorted = [...calendarEvents].sort((a, b) => a.startDate.localeCompare(b.startDate));
    list.innerHTML = '<h3>All Events</h3>' + sorted.map(evt => `
        <div class="cal-event-row ${evt.type}" data-event-id="${evt.id}">
            <span class="cal-event-type-dot ${evt.type}"></span>
            <span class="cal-event-title">${escHtml(evt.title)}</span>
            <span class="cal-event-dates">${formatDateStr(evt.startDate)} - ${formatDateStr(evt.endDate)}</span>
            <button class="cal-event-delete" onclick="event.stopPropagation(); deleteCalendarEvent('${evt.id}')" title="Delete">&#x2715;</button>
        </div>
    `).join('');

    list.querySelectorAll('.cal-event-row').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
            const evt = calendarEvents.find(e => e.id === row.dataset.eventId);
            if (!evt) return;
            const d = new Date(evt.startDate + 'T00:00:00');
            calViewYear = d.getFullYear();
            calViewMonth = d.getMonth();
            renderCalendar();
            setTimeout(() => {
                const pill = document.querySelector(`.cal-event-pill[data-event-id="${evt.id}"]`);
                if (pill) {
                    pill.classList.add('flash');
                    pill.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => pill.classList.remove('flash'), 1200);
                }
            }, 100);
        });
    });
}

async function saveCalendarEvent() {
    const type = document.getElementById('calEventType').value;
    const title = document.getElementById('calEventTitle').value.trim();
    const startDate = document.getElementById('calEventStart').value;
    const endDate = document.getElementById('calEventEnd').value || startDate;
    if (!title || !startDate) { alert('Please enter a title and start date.'); return; }
    try {
        const res = await fetch('/api/calendar-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: '', startDate, endDate, type, title })
        });
        const newEvt = await res.json();
        calendarEvents.push(newEvt);
        document.getElementById('calEventTitle').value = '';
        document.getElementById('calEventStart').value = '';
        document.getElementById('calEventEnd').value = '';
        renderCalendar();
        if (document.getElementById('dashFilterNoConflicts').checked) applyDashboardFilters();
    } catch (err) { console.error('Failed to add event:', err); alert('Failed to add event.'); }
}

async function deleteCalendarEvent(id) {
    try {
        await fetch(`/api/calendar-events/${id}`, { method: 'DELETE' });
        calendarEvents = calendarEvents.filter(e => e.id !== id);
        closeCalPopup();
        renderCalendar();
        if (document.getElementById('dashFilterNoConflicts').checked) applyDashboardFilters();
    } catch (err) { console.error('Failed to delete event:', err); }
}
