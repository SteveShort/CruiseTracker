// ================================================================
//  ANALYTICS TAB — Chart.js visualizations + Market Brief
// ================================================================

let analyticsLoaded = false;
let analyticsCharts = {};
let analyticsPriceType = 'balcony';
let analyticsLineFilter = '';

// ── Market Brief ────────────────────────────────────────────────────

async function loadMarketBrief() {
    const appMode = getAppMode();
    const loadingEl = document.getElementById('briefLoading');
    const contentEl = document.getElementById('briefContent');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (contentEl) contentEl.style.display = 'none';

    try {
        const lineParam = analyticsLineFilter ? `&line=${encodeURIComponent(analyticsLineFilter)}` : '';
        const data = await fetch(`/api/market-brief?appMode=${appMode}&priceType=${analyticsPriceType}${lineParam}`).then(r => r.json());
        renderMarketPulse(data);
        renderBriefByLine(data.byLine);
        renderBriefAlerts(data.alerts, data.asOf, data.comparedTo);
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = '';
    } catch (err) {
        console.error('Failed to load market brief:', err);
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = '';
    }
}

function renderMarketPulse(data) {
    const el = document.getElementById('briefPulse');
    if (!el) return;
    const ms = data.marketSummary;
    const arrow = ms.avgChangePct < -0.5 ? '↘' : ms.avgChangePct > 0.5 ? '↗' : '→';
    const arrowClass = ms.avgChangePct < -0.5 ? 'pulse-down' : ms.avgChangePct > 0.5 ? 'pulse-up' : 'pulse-flat';
    const priceLabel = analyticsPriceType === 'suite' ? 'Suite' : 'Balcony';

    const total = ms.dropsCount + ms.risesCount + ms.unchangedCount;
    const dropsPct = total > 0 ? Math.round(ms.dropsCount / total * 100) : 0;
    const risesPct = total > 0 ? Math.round(ms.risesCount / total * 100) : 0;
    const flatPct = 100 - dropsPct - risesPct;

    let biggestHtml = '';
    if (ms.biggestDrop) {
        biggestHtml += `<span class="pulse-mover pulse-mover-drop">📉 ${ms.biggestDrop.shipName} <span class="change-badge badge-drop">${ms.biggestDrop.changePct.toFixed(1)}%</span></span>`;
    }
    if (ms.biggestRise) {
        biggestHtml += `<span class="pulse-mover pulse-mover-rise">📈 ${ms.biggestRise.shipName} <span class="change-badge badge-rise">+${ms.biggestRise.changePct.toFixed(1)}%</span></span>`;
    }

    el.innerHTML = `
        <div class="brief-card-title">📊 Market Pulse <span class="chart-info-icon" title="Shows today's overall pricing direction. Compares each sailing's current price to its previous day's price, then counts how many dropped vs rose. The bar shows the ratio — more green (drops) = buyer's market, more red (rises) = seller's market.">ℹ️</span></div>
        <div class="pulse-grid">
            <div class="pulse-main">
                <div class="pulse-arrow ${arrowClass}">${arrow}</div>
                <div class="pulse-avg">
                    <div class="pulse-avg-value">$${ms.avgPpdNow}<span class="pulse-unit">/ppd</span></div>
                    <div class="pulse-avg-label">Avg ${priceLabel} ${ms.avgChangePct > 0 ? '+' : ''}${ms.avgChangePct}% vs previous day</div>
                </div>
            </div>
            <div class="pulse-bar-container">
                <div class="pulse-bar">
                    <div class="pulse-bar-seg pulse-bar-drops" style="width:${dropsPct}%" title="${ms.dropsCount} drops"></div>
                    <div class="pulse-bar-seg pulse-bar-flat" style="width:${flatPct}%" title="${ms.unchangedCount} unchanged"></div>
                    <div class="pulse-bar-seg pulse-bar-rises" style="width:${risesPct}%" title="${ms.risesCount} rises"></div>
                </div>
                <div class="pulse-bar-labels">
                    <span class="pulse-bar-label lbl-drop">▼ ${ms.dropsCount} drops</span>
                    <span class="pulse-bar-label lbl-flat">— ${ms.unchangedCount} flat</span>
                    <span class="pulse-bar-label lbl-rise">▲ ${ms.risesCount} rises</span>
                </div>
            </div>
            <div class="pulse-movers">${biggestHtml || '<span class="pulse-mover-empty">No extreme movers</span>'}</div>
        </div>
        <div class="pulse-meta">${ms.totalSailings.toLocaleString()} sailings compared${data.asOf ? ` · as of ${data.asOf}` : ''}</div>
    `;
}

function renderBriefByLine(byLine) {
    const el = document.getElementById('briefByLine');
    if (!el) return;
    if (!byLine || byLine.length === 0) {
        el.innerHTML = '<div class="brief-empty">No line data available</div>';
        return;
    }

    let html = `<table class="byline-table">
        <thead><tr><th>Line <span class="chart-info-icon" title="Breaks down pricing changes by cruise line. Each line's avg $/ppd is compared to its recent baseline (average of its 2nd-4th most recent scrapes). Drop/rise counts show how many sailings moved in each direction. Click a row to filter all analytics to that line.">ℹ️</span></th><th>Avg $/ppd</th><th>Change</th><th>▼ Drops</th><th>▲ Rises</th><th>Sailings</th></tr></thead>
        <tbody>`;

    byLine.forEach(l => {
        const changeClass = l.avgChangePct < -0.5 ? 'change-drop' : l.avgChangePct > 0.5 ? 'change-rise' : 'change-flat';
        const changePrefix = l.avgChangePct > 0 ? '+' : '';
        html += `<tr class="byline-row" data-line="${l.cruiseLine}">
            <td class="byline-name">${l.cruiseLine}</td>
            <td class="byline-ppd">$${l.avgPpdNow}</td>
            <td class="byline-change ${changeClass}">${changePrefix}${l.avgChangePct}%</td>
            <td class="byline-drops">${l.dropsCount}</td>
            <td class="byline-rises">${l.risesCount}</td>
            <td class="byline-count">${l.sailings}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    el.innerHTML = html;

    // Click a line row to filter
    el.querySelectorAll('.byline-row').forEach(row => {
        row.addEventListener('click', () => {
            const lineName = row.dataset.line;
            const select = document.getElementById('analyticsLineFilter');
            if (select) {
                select.value = lineName;
                select.dispatchEvent(new Event('change'));
            }
        });
    });
}

function renderBriefAlerts(alerts, asOf, comparedTo) {
    const el = document.getElementById('briefAlerts');
    const countEl = document.getElementById('briefAlertCount');
    const titleEl = el?.closest('.brief-card')?.querySelector('.brief-card-title');
    if (!el) return;

    if (countEl) countEl.textContent = alerts.length > 0 ? `(${alerts.length})` : '';

    // Show timeframe in the card title
    if (titleEl && asOf) {
        const fmtTime = (ts) => {
            const d = new Date(ts.replace(' ', 'T'));
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
                d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        };
        titleEl.innerHTML = `🔔 Near Historic Low <span class="brief-alert-count">${alerts.length > 0 ? `(${alerts.length})` : ''}</span> <span class="brief-timeframe">${asOf ? `as of ${fmtTime(asOf)}` : ''}</span>`;
    }

    if (!alerts || alerts.length === 0) {
        el.innerHTML = '<div class="brief-empty">No sailings currently near their historic low price</div>';
        return;
    }

    let html = '<div class="alert-list">';
    alerts.forEach((a, idx) => {
        const icon = '📉';
        const badgeClass = 'badge-drop';
        const prefix = '';
        const depDate = new Date(a.departureDate + 'T00:00:00');
        const dateStr = depDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const alertId = `alert-chart-${idx}`;

        html += `<div class="alert-item">
            <div class="alert-row alert-drop alert-clickable"
                 data-line="${a.cruiseLine}" data-ship="${a.shipName}" data-date="${a.departureDate}" data-target="${alertId}">
                <span class="alert-icon">${icon}</span>
                <div class="alert-info">
                    <span class="alert-ship">${a.shipName}</span>
                    <span class="alert-detail">${a.cruiseLine} · ${dateStr} · ${a.nights}n · ${a.departurePort}</span>
                </div>
                <div class="alert-price">
                    <span class="alert-old" title="Peak price">$${a.previousPpd}</span>
                    <span class="alert-arrow">→</span>
                    <span class="alert-new" title="Current price">$${a.currentPpd}</span>
                </div>
                <span class="change-badge ${badgeClass}">${a.changePct.toFixed(1)}% vs peak</span>
                <span class="alert-expand-icon">▸</span>
            </div>
            <div class="alert-chart-container" id="${alertId}">
                <div class="alert-chart-wrap"><canvas></canvas></div>
            </div>
        </div>`;
    });
    html += '</div>';
    el.innerHTML = html;

    // Wire up click-to-expand
    el.querySelectorAll('.alert-clickable').forEach(row => {
        row.addEventListener('click', async () => {
            const targetId = row.dataset.target;
            const chartContainer = document.getElementById(targetId);
            if (!chartContainer) return;

            const isOpen = chartContainer.classList.contains('expanded');
            // Close all other open charts
            el.querySelectorAll('.alert-chart-container.expanded').forEach(c => {
                c.classList.remove('expanded');
                const expandIcon = c.closest('.alert-item')?.querySelector('.alert-expand-icon');
                if (expandIcon) expandIcon.textContent = '▸';
            });

            if (!isOpen) {
                chartContainer.classList.add('expanded');
                row.querySelector('.alert-expand-icon').textContent = '▾';
                // Load chart if not already loaded
                if (!chartContainer._loaded) {
                    chartContainer._loaded = true;
                    const wrap = chartContainer.querySelector('.alert-chart-wrap');
                    const mode = analyticsPriceType === 'suite' ? 'suite' : 'balcony';
                    await loadInlineChart(wrap, row.dataset.line, row.dataset.ship, row.dataset.date, mode);
                }
            }
        });
    });
}

// ── Existing analytics charts ───────────────────────────────────────

async function loadAnalytics(force) {
    if (analyticsLoaded && !force) return;
    analyticsLoaded = true;

    // Destroy existing charts
    Object.values(analyticsCharts).forEach(c => { if (c && c.destroy) c.destroy(); });
    analyticsCharts = {};
    const heatmap = document.getElementById('monthlyHeatmap');
    if (heatmap) heatmap.innerHTML = '';

    const appMode = getAppMode();
    const lineParam = analyticsLineFilter ? `&line=${encodeURIComponent(analyticsLineFilter)}` : '';
    // Show loading spinner, hide charts
    const loadingEl = document.getElementById('analyticsLoading');
    const gridEl = document.getElementById('analyticsGrid');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (gridEl) gridEl.style.display = 'none';
    try {
        const [data, sentimentData] = await Promise.all([
            fetch(`/api/analytics?appMode=${appMode}&priceType=${analyticsPriceType}${lineParam}`).then(r => r.json()),
            fetch(`/api/market-sentiment?appMode=${appMode}&priceType=${analyticsPriceType}${lineParam}`).then(r => r.json())
        ]);
        renderByLineChart(data.byLine);
        renderDepartureChart(data.departureCurve);
        renderSentimentChart(sentimentData);
        renderMarketPulseHistory(sentimentData);
        renderNearTermChart(data.nearTermTrend);
        renderByShipChart(data.byShip);
        renderMonthlyHeatmap(data.monthly);

        // Show total snapshots
        const totalSnaps = data.departureCurve.reduce((sum, d) => sum + d.snapshots, 0);
        const el = document.getElementById('analyticsSnapshots');
        if (el) el.textContent = totalSnaps.toLocaleString();

        // Hide loading, show charts
        if (loadingEl) loadingEl.style.display = 'none';
        if (gridEl) gridEl.style.display = '';
    } catch (err) {
        console.error('Failed to load analytics:', err);
        if (loadingEl) loadingEl.style.display = 'none';
        if (gridEl) gridEl.style.display = '';
    }
}

// Reset analytics when mode changes
function resetAnalytics() {
    analyticsLoaded = false;
    analyticsLineFilter = '';
    Object.values(analyticsCharts).forEach(c => { if (c && c.destroy) c.destroy(); });
    analyticsCharts = {};
    const heatmap = document.getElementById('monthlyHeatmap');
    if (heatmap) heatmap.innerHTML = '';
    // Reset line filter selection
    const lineSelect = document.getElementById('analyticsLineFilter');
    if (lineSelect) lineSelect.value = '';
    // Reload if tab is currently visible
    const tab = document.getElementById('tab-analytics');
    if (tab && tab.classList.contains('active')) {
        populateLineFilter();
        loadMarketBrief();
        loadAnalytics(true);
    }
}

// ── Color palettes ──────────────────────────────────────────────────

const lineColors = {
    Norwegian: { bg: 'rgba(8, 145, 178, 0.7)', border: '#0891b2' },
    Disney: { bg: 'rgba(30, 64, 175, 0.7)', border: '#1e40af' },
    Celebrity: { bg: 'rgba(124, 58, 237, 0.7)', border: '#7c3aed' },
    'Virgin Voyages': { bg: 'rgba(220, 38, 38, 0.7)', border: '#dc2626' },
    Oceania: { bg: 'rgba(16, 185, 129, 0.7)', border: '#10b981' },
    Regent: { bg: 'rgba(245, 158, 11, 0.7)', border: '#f59e0b' },
    Silversea: { bg: 'rgba(148, 163, 184, 0.7)', border: '#94a3b8' },
    Seabourn: { bg: 'rgba(168, 85, 247, 0.7)', border: '#a855f7' },
};

function getLineColor(line) {
    return lineColors[line] || { bg: 'rgba(100, 116, 139, 0.7)', border: '#64748b' };
}

const chartDefaults = {
    color: '#94a3b8',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    font: { family: "'Inter', sans-serif" }
};

// ── 1. Average Price by Cruise Line ─────────────────────────────────

function renderByLineChart(byLine) {
    const ctx = document.getElementById('chartByLine');
    if (!ctx) return;

    const labels = byLine.map(d => d.cruiseLine);
    const avgData = byLine.map(d => d.avgPpd);
    const minData = byLine.map(d => d.minPpd);
    const colors = labels.map(l => getLineColor(l));
    const priceLabel = analyticsPriceType === 'suite' ? 'Suite' : 'Balcony';

    analyticsCharts.byLine = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: `Avg ${priceLabel} $/ppd`,
                    data: avgData,
                    backgroundColor: colors.map(c => c.bg),
                    borderColor: colors.map(c => c.border),
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: `Min ${priceLabel} $/ppd`,
                    data: minData,
                    backgroundColor: colors.map(c => c.bg.replace('0.7', '0.3')),
                    borderColor: colors.map(c => c.border),
                    borderWidth: 1,
                    borderRadius: 4,
                    borderDash: [4, 4],
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: chartDefaults.color, font: chartDefaults.font } },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: $${ctx.parsed.x}/ppd`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.borderColor },
                    ticks: { color: chartDefaults.color, callback: v => `$${v}` }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#f1f5f9', font: { weight: '600' } }
                }
            }
        }
    });
}

// ── 2. Price vs Days to Departure ───────────────────────────────────

function renderDepartureChart(departureCurve) {
    const ctx = document.getElementById('chartDeparture');
    if (!ctx) return;

    const lines = [...new Set(departureCurve.map(d => d.cruiseLine))];
    const dayLabels = [450, 320, 225, 150, 105, 75, 45, 22, 7];
    const dayLabelNames = ['15mo', '11mo', '7mo', '5mo', '3.5mo', '2.5mo', '6wk', '3wk', '1wk'];

    const datasets = lines.map(line => {
        const lineData = departureCurve.filter(d => d.cruiseLine === line);
        const color = getLineColor(line);
        return {
            label: line,
            data: dayLabels.map(day => {
                const match = lineData.find(d => d.daysOut === day);
                return match ? match.avgPpd : null;
            }),
            borderColor: color.border,
            backgroundColor: color.bg,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            spanGaps: true,
        };
    });

    analyticsCharts.departure = new Chart(ctx, {
        type: 'line',
        data: { labels: dayLabelNames, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: chartDefaults.color, font: chartDefaults.font, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}: $${ctx.parsed.y}/ppd` : null
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: chartDefaults.borderColor },
                    ticks: { color: chartDefaults.color, callback: v => `$${v}` },
                    title: { display: true, text: 'Avg $/ppd', color: chartDefaults.color }
                },
                x: {
                    grid: { color: chartDefaults.borderColor },
                    ticks: { color: chartDefaults.color },
                    title: { display: true, text: 'Time before departure →', color: chartDefaults.color }
                }
            }
        }
    });
}

// ── 3. Price by Ship ────────────────────────────────────────────────

function renderByShipChart(byShip) {
    const ctx = document.getElementById('chartByShip');
    if (!ctx) return;

    // Sort by avg price
    const sorted = [...byShip].sort((a, b) => a.avgPpd - b.avgPpd);
    const labels = sorted.map(s => s.shipName);
    const avgData = sorted.map(s => s.avgPpd);

    // Color by ship quality score (higher = greener)
    const qualityColors = sorted.map(s => {
        const q = s.shipScore || 50;
        if (q >= 90) return 'rgba(16, 185, 129, 0.8)';  // green — excellent
        if (q >= 80) return 'rgba(34, 211, 238, 0.7)';   // cyan — great
        if (q >= 70) return 'rgba(99, 102, 241, 0.7)';   // blue — good
        return 'rgba(148, 163, 184, 0.5)';                // gray — average
    });

    // Dynamic height based on ship count
    const containerEl = ctx.parentElement;
    if (containerEl) containerEl.style.height = Math.max(400, sorted.length * 28) + 'px';

    analyticsCharts.byShip = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Avg $/ppd',
                data: avgData,
                backgroundColor: qualityColors,
                borderRadius: 3,
                barThickness: 18,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => {
                            const s = sorted[ctx.dataIndex];
                            return `Ship: ${s.shipScore} | Dining: ${s.diningScore} | ${s.sailings} sailings`;
                        },
                        label: ctx => `Avg: $${ctx.parsed.x}/ppd`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.borderColor },
                    ticks: { color: chartDefaults.color, callback: v => `$${v}` }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#e2e8f0', font: { size: 11 } }
                }
            }
        }
    });

    // Render quality legend below the chart
    const legendId = 'shipQualityLegend';
    let legendEl = document.getElementById(legendId);
    if (!legendEl) {
        legendEl = document.createElement('div');
        legendEl.id = legendId;
        legendEl.className = 'ship-quality-legend';
        containerEl.parentElement.appendChild(legendEl);
    }
    legendEl.innerHTML = `
        <span class="sq-legend-item"><span class="sq-dot" style="background:rgba(16,185,129,0.8)"></span> Excellent (90+)</span>
        <span class="sq-legend-item"><span class="sq-dot" style="background:rgba(34,211,238,0.7)"></span> Great (80-89)</span>
        <span class="sq-legend-item"><span class="sq-dot" style="background:rgba(99,102,241,0.7)"></span> Good (70-79)</span>
        <span class="sq-legend-item"><span class="sq-dot" style="background:rgba(148,163,184,0.5)"></span> Average (&lt;70)</span>
    `;
}

// ── 4. Market Sentiment Index ───────────────────────────────────────

function renderSentimentChart(sentimentData) {
    const ctx = document.getElementById('chartSentiment');
    if (!ctx || !sentimentData || sentimentData.length === 0) return;

    const dates = sentimentData.map(d => d.date);
    const dateLabels = dates.map(d => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const smoothedData = sentimentData.map(d => d.smoothedScore);
    const rawData = sentimentData.map(d => d.rawScore);

    // Create gradient fills for above/below zero
    const canvas = ctx.getContext('2d');
    const greenGrad = canvas.createLinearGradient(0, 0, 0, ctx.parentElement?.offsetHeight || 350);
    greenGrad.addColorStop(0, 'rgba(16, 185, 129, 0)');
    greenGrad.addColorStop(0.5, 'rgba(16, 185, 129, 0)');
    greenGrad.addColorStop(1, 'rgba(16, 185, 129, 0.15)');

    const redGrad = canvas.createLinearGradient(0, 0, 0, ctx.parentElement?.offsetHeight || 350);
    redGrad.addColorStop(0, 'rgba(239, 68, 68, 0.15)');
    redGrad.addColorStop(0.5, 'rgba(239, 68, 68, 0)');
    redGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');

    analyticsCharts.sentiment = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                {
                    label: 'Smoothed (3-day)',
                    data: smoothedData,
                    borderColor: '#22d3ee',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 2,
                    pointHoverRadius: 6,
                    borderWidth: 2.5,
                    fill: false,
                },
                {
                    label: 'Raw Score',
                    data: rawData,
                    borderColor: 'rgba(148, 163, 184, 0.4)',
                    backgroundColor: 'transparent',
                    tension: 0.2,
                    pointRadius: 0,
                    borderWidth: 1,
                    borderDash: [4, 3],
                    fill: false,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: chartDefaults.color, font: chartDefaults.font, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            return dates[idx] || dateLabels[idx];
                        },
                        afterBody: (items) => {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            const d = sentimentData[idx];
                            if (!d) return '';
                            return [
                                `▼ ${d.drops} drops  ▲ ${d.rises} rises  — ${d.unchanged} flat`,
                                `Avg PPD: $${d.avgPpd}`,
                                d.smoothedScore <= -50 ? '🟢 Strong buyer\'s market' :
                                    d.smoothedScore <= -20 ? '🟡 Prices softening' :
                                        d.smoothedScore >= 50 ? '🔴 Seller\'s market' :
                                            d.smoothedScore >= 20 ? '🟠 Prices firming up' :
                                                '⚪ Stable/neutral'
                            ];
                        }
                    }
                },
                // Zero line annotation via custom plugin
                annotation: undefined
            },
            scales: {
                y: {
                    min: -100,
                    max: 100,
                    grid: {
                        color: (ctx) => ctx.tick.value === 0 ? 'rgba(255, 255, 255, 0.3)' : chartDefaults.borderColor,
                        lineWidth: (ctx) => ctx.tick.value === 0 ? 2 : 1,
                    },
                    ticks: {
                        color: (ctx) => {
                            const v = ctx.tick.value;
                            if (v <= -50) return '#10b981';
                            if (v >= 50) return '#ef4444';
                            return chartDefaults.color;
                        },
                        stepSize: 25,
                        callback: v => {
                            if (v === 100) return '+100 (all rising)';
                            if (v === -100) return '-100 (all falling)';
                            if (v === 0) return '0 (neutral)';
                            return v > 0 ? `+${v}` : `${v}`;
                        }
                    },
                    title: { display: true, text: 'Sentiment Score', color: chartDefaults.color }
                },
                x: {
                    grid: { color: chartDefaults.borderColor },
                    ticks: {
                        color: chartDefaults.color,
                        maxTicksLimit: 15,
                        maxRotation: 45
                    },
                    title: { display: true, text: 'Date', color: chartDefaults.color }
                }
            }
        }
    });
}

function renderMarketPulseHistory(sentimentData) {
    const ctx = document.getElementById('chartPulseHistory');
    if (!ctx || !sentimentData || sentimentData.length === 0) return;

    // Destroy existing chart if any
    if (analyticsCharts.pulseHistory) {
        analyticsCharts.pulseHistory.destroy();
    }

    // Clear any existing detail panel
    const detailEl = document.getElementById('pulseHistoryDetail');
    if (detailEl) detailEl.innerHTML = '';

    const dates = sentimentData.map(d => d.date);
    const dateLabels = dates.map(d => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    // Net = rises - drops: positive means more rises (red up), negative means more drops (green down)
    const netValues = sentimentData.map(d => d.rises - d.drops);

    // Color each bar: red for positive (more rises), green for negative (more drops)
    const barColors = netValues.map(v =>
        v > 0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(16, 185, 129, 0.7)'
    );
    const borderColors = netValues.map(v =>
        v > 0 ? '#ef4444' : '#10b981'
    );

    // Track selected bar index
    let selectedBarIndex = -1;

    analyticsCharts.pulseHistory = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dateLabels,
            datasets: [{
                label: 'Net Rises − Drops',
                data: netValues,
                backgroundColor: barColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: async (event, elements) => {
                if (!elements || elements.length === 0) return;
                const idx = elements[0].index;
                const clickedDate = dates[idx];

                // If clicking the same bar, toggle off
                if (selectedBarIndex === idx) {
                    selectedBarIndex = -1;
                    // Reset all bar colors
                    const ds = analyticsCharts.pulseHistory.data.datasets[0];
                    ds.borderWidth = netValues.map(() => 1);
                    ds.backgroundColor = netValues.map(v =>
                        v > 0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(16, 185, 129, 0.7)'
                    );
                    ds.borderColor = netValues.map(v =>
                        v > 0 ? '#ef4444' : '#10b981'
                    );
                    analyticsCharts.pulseHistory.update();
                    if (detailEl) {
                        detailEl.classList.remove('expanded');
                        setTimeout(() => { detailEl.innerHTML = ''; }, 300);
                    }
                    return;
                }

                selectedBarIndex = idx;

                // Highlight the selected bar
                const ds = analyticsCharts.pulseHistory.data.datasets[0];
                ds.borderWidth = netValues.map((_, i) => i === idx ? 3 : 1);
                ds.backgroundColor = netValues.map((v, i) => {
                    if (i === idx) return v > 0 ? 'rgba(239, 68, 68, 1)' : 'rgba(16, 185, 129, 1)';
                    return v > 0 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.35)';
                });
                ds.borderColor = netValues.map((v, i) => {
                    if (i === idx) return '#fff';
                    return v > 0 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(16, 185, 129, 0.5)';
                });
                analyticsCharts.pulseHistory.update();

                // Fetch per-line breakdown for the clicked date
                if (detailEl) {
                    detailEl.innerHTML = '<div class="pulse-detail-loading"><div class="spinner"></div> Loading breakdown...</div>';
                    detailEl.classList.add('expanded');
                }

                try {
                    const appMode = getAppMode();
                    const lineParam = analyticsLineFilter ? `&line=${encodeURIComponent(analyticsLineFilter)}` : '';
                    const data = await fetch(`/api/market-sentiment/${clickedDate}?appMode=${appMode}&priceType=${analyticsPriceType}${lineParam}`).then(r => r.json());
                    renderPulseHistoryDetail(clickedDate, dateLabels[idx], data.byLine);
                } catch (err) {
                    console.error('Failed to load pulse detail:', err);
                    if (detailEl) detailEl.innerHTML = '<div class="pulse-detail-error">Failed to load breakdown</div>';
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            return dates[idx] || dateLabels[idx];
                        },
                        label: (ctx) => {
                            const idx = ctx.dataIndex;
                            const d = sentimentData[idx];
                            if (!d) return '';
                            const net = d.rises - d.drops;
                            const dir = net > 0 ? '▲ More rises' : net < 0 ? '▼ More drops' : '— Balanced';
                            return [
                                dir,
                                `▼ ${d.drops} drops  ▲ ${d.rises} rises  — ${d.unchanged} flat`,
                                `Avg PPD: $${d.avgPpd}`,
                                '',
                                'Click for line-by-line breakdown'
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: {
                        color: (ctx) => ctx.tick.value === 0 ? 'rgba(255, 255, 255, 0.3)' : chartDefaults.borderColor,
                        lineWidth: (ctx) => ctx.tick.value === 0 ? 2 : 1,
                    },
                    ticks: {
                        color: (ctx) => {
                            const v = ctx.tick.value;
                            if (v < 0) return '#10b981';
                            if (v > 0) return '#ef4444';
                            return chartDefaults.color;
                        },
                        callback: v => {
                            if (v === 0) return '0';
                            return v > 0 ? `+${v}` : `${v}`;
                        }
                    },
                    title: { display: true, text: 'Net (rises − drops)', color: chartDefaults.color }
                },
                x: {
                    grid: { color: chartDefaults.borderColor },
                    ticks: {
                        color: chartDefaults.color,
                        maxTicksLimit: 15,
                        maxRotation: 45
                    }
                }
            }
        }
    });
}

function renderPulseHistoryDetail(date, dateLabel, byLine) {
    const el = document.getElementById('pulseHistoryDetail');
    if (!el) return;

    if (!byLine || byLine.length === 0) {
        el.innerHTML = `<div class="pulse-detail-empty">No per-line data for ${dateLabel}</div>`;
        el.classList.add('expanded');
        return;
    }

    let html = `<div class="pulse-detail-header">
        <span class="pulse-detail-date">📋 Line-by-Line for ${dateLabel}</span>
        <button class="pulse-detail-close" onclick="document.getElementById('pulseHistoryDetail').classList.remove('expanded');setTimeout(()=>{document.getElementById('pulseHistoryDetail').innerHTML='';},300)">✕</button>
    </div>`;
    html += `<table class="byline-table">
        <thead><tr><th>Line</th><th>Avg $/ppd</th><th>Change</th><th>▼ Drops</th><th>▲ Rises</th><th>Sailings</th></tr></thead>
        <tbody>`;

    byLine.forEach(l => {
        const changeClass = l.avgChangePct < -0.5 ? 'change-drop' : l.avgChangePct > 0.5 ? 'change-rise' : 'change-flat';
        const changePrefix = l.avgChangePct > 0 ? '+' : '';
        html += `<tr>
            <td class="byline-name">${l.cruiseLine}</td>
            <td class="byline-ppd">$${l.avgPpdNow}</td>
            <td class="byline-change ${changeClass}">${changePrefix}${l.avgChangePct}%</td>
            <td class="byline-drops">${l.dropsCount}</td>
            <td class="byline-rises">${l.risesCount}</td>
            <td class="byline-count">${l.sailings}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    el.innerHTML = html;
    el.classList.add('expanded');
}

// ── 5. Near-Term Pricing Trend ──────────────────────────────────────

function renderNearTermChart(nearTermTrend) {
    const ctx = document.getElementById('chartNearTerm');
    if (!ctx || !nearTermTrend || nearTermTrend.length === 0) return;

    const lines = [...new Set(nearTermTrend.map(d => d.cruiseLine))];
    const dates = [...new Set(nearTermTrend.map(d => d.scrapeDate))].sort();

    // Format date labels: "Mar 1", "Mar 2", etc.
    const dateLabels = dates.map(d => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const datasets = lines.map(line => {
        const lineData = nearTermTrend.filter(d => d.cruiseLine === line);
        const color = getLineColor(line);
        return {
            label: line,
            data: dates.map(date => {
                const match = lineData.find(d => d.scrapeDate === date);
                return match ? match.avgPpd : null;
            }),
            borderColor: color.border,
            backgroundColor: color.bg,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            borderWidth: 2,
            spanGaps: true,
        };
    });

    const priceLabel = analyticsPriceType === 'suite' ? 'Suite' : 'Balcony';

    analyticsCharts.nearTerm = new Chart(ctx, {
        type: 'line',
        data: { labels: dateLabels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: chartDefaults.color, font: chartDefaults.font, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            return dates[idx] || dateLabels[idx];
                        },
                        label: ctx => {
                            if (ctx.parsed.y == null) return null;
                            const idx = ctx.dataIndex;
                            const line = ctx.dataset.label;
                            const match = nearTermTrend.find(d => d.scrapeDate === dates[idx] && d.cruiseLine === line);
                            const sailings = match ? match.sailings : '?';
                            return `${line}: $${ctx.parsed.y}/ppd (${sailings} sailings)`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: chartDefaults.borderColor },
                    ticks: { color: chartDefaults.color, callback: v => `$${v}` },
                    title: { display: true, text: `Avg ${priceLabel} $/ppd (next 2mo)`, color: chartDefaults.color }
                },
                x: {
                    grid: { color: chartDefaults.borderColor },
                    ticks: {
                        color: chartDefaults.color,
                        maxTicksLimit: 15,
                        maxRotation: 45
                    },
                    title: { display: true, text: 'Scrape date', color: chartDefaults.color }
                }
            }
        }
    });
}

// ── 5. Monthly Price Heatmap ────────────────────────────────────────

function renderMonthlyHeatmap(monthly) {
    const container = document.getElementById('monthlyHeatmap');
    if (!container) return;

    const lines = [...new Set(monthly.map(d => d.cruiseLine))];
    const months = [...new Set(monthly.map(d => `${d.year}-${String(d.month).padStart(2, '0')}`))].sort();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Find global min/max for color scale
    const allPrices = monthly.map(d => d.avgPpd);
    const globalMin = Math.min(...allPrices);
    const globalMax = Math.max(...allPrices);

    function priceColor(ppd) {
        const ratio = Math.min(1, Math.max(0, (ppd - globalMin) / (globalMax - globalMin || 1)));
        if (ratio < 0.33) return `rgba(16, 185, 129, ${0.3 + ratio * 1.5})`;  // green
        if (ratio < 0.66) return `rgba(245, 158, 11, ${0.3 + (ratio - 0.33) * 1.5})`; // amber
        return `rgba(239, 68, 68, ${0.3 + (ratio - 0.66) * 1.5})`; // red
    }

    let html = '<div class="heatmap-grid" style="grid-template-columns: 120px repeat(' + months.length + ', 1fr)">';

    // Header row
    html += '<div class="heatmap-cell heatmap-corner"></div>';
    months.forEach(m => {
        const [yr, mo] = m.split('-');
        const label = `${monthNames[parseInt(mo) - 1]} '${yr.slice(2)}`;
        html += `<div class="heatmap-cell heatmap-header">${label}</div>`;
    });

    // Data rows
    lines.forEach(line => {
        html += `<div class="heatmap-cell heatmap-row-label">${line}</div>`;
        months.forEach(m => {
            const [yr, mo] = m.split('-');
            const d = monthly.find(x => x.cruiseLine === line && x.year === parseInt(yr) && x.month === parseInt(mo));
            if (d) {
                html += `<div class="heatmap-cell heatmap-data" style="background:${priceColor(d.avgPpd)}" title="${line} ${monthNames[parseInt(mo) - 1]} ${yr}: $${d.avgPpd}/ppd (${d.sailings} sailings)">$${d.avgPpd}</div>`;
            } else {
                html += '<div class="heatmap-cell heatmap-empty">—</div>';
            }
        });
    });

    html += '</div>';
    html += `<div class="heatmap-legend"><span class="heatmap-legend-low">🟢 $${globalMin}</span> <span class="heatmap-legend-mid">🟡 mid</span> <span class="heatmap-legend-high">🔴 $${globalMax}</span></div>`;
    container.innerHTML = html;
}

// ── Populate line filter dropdown ───────────────────────────────────

async function populateLineFilter() {
    const select = document.getElementById('analyticsLineFilter');
    if (!select) return;
    try {
        const appMode = getAppMode();
        const opts = await fetch(`/api/filter-options?appMode=${appMode}`).then(r => r.json());
        // Keep "All Lines" option, add cruise lines
        select.innerHTML = '<option value="">All Lines</option>';
        (opts.lines || []).forEach(l => {
            const opt = document.createElement('option');
            opt.value = l;
            opt.textContent = l;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('Failed to load line filter options:', err);
    }
}

// ── Tab switching hook + price toggle + line filter ─────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Load analytics lazily when tab is activated
    const observer = new MutationObserver(() => {
        const analyticsTab = document.getElementById('tab-analytics');
        if (analyticsTab && analyticsTab.classList.contains('active') && !analyticsLoaded) {
            populateLineFilter();
            loadMarketBrief();
            loadAnalytics();
        }
    });

    const tabContainer = document.getElementById('tab-analytics');
    if (tabContainer) {
        observer.observe(tabContainer, { attributes: true, attributeFilter: ['class'] });
    }

    // Balcony/Suite toggle
    const priceToggle = document.getElementById('analyticsPriceToggle');
    if (priceToggle) {
        priceToggle.querySelectorAll('.analytics-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('active')) return;
                priceToggle.querySelectorAll('.analytics-toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                analyticsPriceType = btn.dataset.pricetype;
                analyticsLoaded = false;
                loadMarketBrief();
                loadAnalytics(true);
            });
        });
    }

    // Line filter
    const lineSelect = document.getElementById('analyticsLineFilter');
    if (lineSelect) {
        lineSelect.addEventListener('change', () => {
            analyticsLineFilter = lineSelect.value;
            analyticsLoaded = false;
            loadMarketBrief();
            loadAnalytics(true);
        });
    }
});
