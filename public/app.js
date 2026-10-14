const SEMINARS_API_ENDPOINT = "/api/seminars.csv";
const DEFAULT_TIME_ZONE = "Europe/Berlin";
const DEFAULT_TIME_ZONE_LABEL = "CEST/CET";
const DEFAULT_EVENT_DURATION_MINUTES = 90;

const TIME_ZONE_ALIASES = {
  CEST: "Europe/Berlin",
  CET: "Europe/Berlin",
  CST: "Europe/Berlin",
};

const upcomingList = document.getElementById("upcoming-list");
const pastList = document.getElementById("past-list");
const upcomingEmpty = document.getElementById("upcoming-empty");
const pastEmpty = document.getElementById("past-empty");
const copyrightYear = document.getElementById("copyright-year");
const heroFeatureCard = document.getElementById("hero-feature-card");
const heroSeriesCount = document.getElementById("hero-series-count");
const heroNextDate = document.getElementById("hero-next-date");
const DEFAULT_UPCOMING_EMPTY_TEXT =
  upcomingEmpty?.textContent || "No upcoming seminars yet";
const DEFAULT_PAST_EMPTY_TEXT =
  pastEmpty?.textContent || "No past seminars.";

setCurrentYear();
showLoadingState();

init().catch((err) => {
  console.error("Unable to load seminars", err);
  upcomingEmpty.textContent = "The seminar programme is temporarily unavailable. Please try again shortly.";
  upcomingEmpty.classList.remove("hidden");
  pastEmpty.classList.add("hidden");
});

function showLoadingState() {
  if (upcomingEmpty) {
    upcomingEmpty.textContent = "Please wait, loading...";
    upcomingEmpty.classList.remove("hidden");
  }
  if (pastEmpty) {
    pastEmpty.classList.add("hidden");
  }
}

function setCurrentYear() {
  if (copyrightYear) {
    copyrightYear.textContent = String(new Date().getFullYear());
  }
}

async function init() {
  const csvText = await loadCsvFromApi(SEMINARS_API_ENDPOINT);
  const seminars = parseCsv(csvText)
    .map(normalizeSeminar)
    .filter((item) => item.ok)
    .map((item) => item.value);

  renderSeminars(seminars);
}

async function loadCsvFromApi(source) {
  const response = await fetch(source, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const csvText = await response.text();
  if (!csvText.trim()) {
    throw new Error("Seminar feed is empty");
  }

  return csvText;
}

function parseCsv(csvText) {
  const matrix = [];
  const source = String(csvText || "").replace(/^\uFEFF/, "");
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) matrix.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) matrix.push(row);

  if (matrix.length < 2) {
    return [];
  }

  const headers = matrix[0].map((header) => header.trim().toLowerCase());

  return matrix.slice(1).map((values) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = (values[index] || "").trim();
    });
    return obj;
  });
}

function normalizeSeminar(raw) {
  const requiredFields = ["date", "speaker", "title"];
  const missing = requiredFields.find((field) => !raw[field]);
  const registerLink = normalizeExternalUrl(raw.link || raw.register_link || "");

  if (missing) {
    return { ok: false };
  }

  const startTime = normalizeTimeInput(raw.time || "");
  const endTime = normalizeTimeInput(raw.end_time || "");
  const timeZone = resolveTimeZone(raw.timezone || "");
  const timeZoneLabel = (raw.timezone || "").trim() || DEFAULT_TIME_ZONE_LABEL;

  const window = parseSeminarWindow(raw.date, startTime, endTime, timeZone);
  if (!window) {
    return { ok: false };
  }

  const published = (raw.published || "yes").trim().toLowerCase();

  return {
    ok: true,
    value: {
      dateIso: raw.date,
      startAt: window.startAt,
      endAt: window.endAt,
      hasTime: window.hasTime,
      startTime,
      endTime,
      timeZone,
      timeZoneLabel,
      title: raw.title,
      speaker: raw.speaker,
      speakerDetail: (raw.speaker_detail || raw.affiliation || "").trim(),
      speakerPortfolio: normalizeExternalUrl(raw.speaker_portfolio || raw.speaker_url || ""),
      venue: raw.venue || "",
      registerLink,
      abstract: raw.abstract || "",
      isPublished: published !== "no",
    },
  };
}

function normalizeTimeInput(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const match = text.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) {
    return "";
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("//")) {
    return normalizeExternalUrl(`https:${raw}`);
  }

  if (/^(https?:|mailto:|tel:)/i.test(raw)) {
    return isValidExternalUrl(raw) ? raw : "";
  }

  const normalized = `https://${raw.replace(/^\/+/, "")}`;
  return isValidExternalUrl(normalized) ? normalized : "";
}

function isValidExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function parseSeminarWindow(dateInput, startTime, endTime, timeZone) {
  if (!isValidDateIso(dateInput)) {
    return null;
  }

  if (!startTime) {
    const startAt = zonedDateTimeToUtc(dateInput, "00:00", timeZone);
    const nextDateIso = incrementDateIso(dateInput);
    const endAt = zonedDateTimeToUtc(nextDateIso, "00:00", timeZone);
    if (!startAt || !endAt) {
      return null;
    }
    return {
      hasTime: false,
      startAt,
      endAt,
    };
  }

  const startAt = zonedDateTimeToUtc(dateInput, startTime, timeZone);
  if (!startAt) {
    return null;
  }

  let endAt;
  if (endTime) {
    endAt = zonedDateTimeToUtc(dateInput, endTime, timeZone);
    if (!endAt) {
      return null;
    }
    if (endAt.getTime() <= startAt.getTime()) {
      endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    endAt = new Date(startAt.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60 * 1000);
  }

  return {
    hasTime: true,
    startAt,
    endAt,
  };
}

function isValidDateIso(dateInput) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateInput || "").trim());
}

function incrementDateIso(dateInput) {
  const parts = dateInput.split("-").map(Number);
  const nextDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
  return [
    String(nextDay.getUTCFullYear()),
    String(nextDay.getUTCMonth() + 1).padStart(2, "0"),
    String(nextDay.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function resolveTimeZone(rawTimeZone) {
  const value = String(rawTimeZone || "").trim();
  if (!value) {
    return DEFAULT_TIME_ZONE;
  }

  const alias = TIME_ZONE_ALIASES[value.toUpperCase()];
  if (alias) {
    return alias;
  }

  if (isValidTimeZone(value)) {
    return value;
  }

  return DEFAULT_TIME_ZONE;
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedDateTimeToUtc(dateInput, timeInput, timeZone) {
  if (!isValidDateIso(dateInput) || !normalizeTimeInput(timeInput)) {
    return null;
  }

  const [year, month, day] = dateInput.split("-").map(Number);
  const [hour, minute] = normalizeTimeInput(timeInput).split(":").map(Number);

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let candidate = new Date(utcGuess);
  let offset = getTimeZoneOffsetMs(candidate, timeZone);
  let corrected = utcGuess - offset;
  candidate = new Date(corrected);

  const secondOffset = getTimeZoneOffsetMs(candidate, timeZone);
  if (secondOffset !== offset) {
    corrected = utcGuess - secondOffset;
    candidate = new Date(corrected);
  }

  if (Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function getTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      map[part.type] = Number(part.value);
    }
  });

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function renderSeminars(seminars) {
  const now = new Date();
  const visible = seminars.filter((s) => s.isPublished);
  const upcoming = visible
    .filter((s) => s.endAt >= now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const past = visible
    .filter((s) => s.endAt < now)
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  const remainingUpcoming = upcoming.slice(1);

  renderHeroFeature(upcoming, past.length);
  renderCardGroup(upcomingList, remainingUpcoming, false);
  renderCardGroup(pastList, past, true);

  if (upcoming.length === 0) {
    upcomingEmpty.textContent = DEFAULT_UPCOMING_EMPTY_TEXT;
    upcomingEmpty.classList.remove("hidden");
  } else if (remainingUpcoming.length === 0) {
    upcomingEmpty.textContent = "No additional upcoming seminars yet.";
    upcomingEmpty.classList.remove("hidden");
  } else {
    upcomingEmpty.textContent = DEFAULT_UPCOMING_EMPTY_TEXT;
    upcomingEmpty.classList.add("hidden");
  }

  pastEmpty.textContent = DEFAULT_PAST_EMPTY_TEXT;
  pastEmpty.classList.toggle("hidden", past.length > 0);
}

function renderCardGroup(target, seminars, isPast) {
  target.innerHTML = "";
  const monthGroups = new Map();

  seminars.forEach((seminar, index) => {
    const monthKey = seminar.dateIso.slice(0, 7);
    let monthCards = monthGroups.get(monthKey);

    if (!monthCards) {
      const group = document.createElement("section");
      group.className = "seminar-month-group";

      const heading = document.createElement("h3");
      heading.className = "seminar-month-heading";
      heading.id = `${target.id}-${monthKey}`;
      heading.textContent = new Intl.DateTimeFormat("en-GB", {
        timeZone: seminar.timeZone,
        month: "long",
        year: "numeric",
      }).format(seminar.startAt);
      group.setAttribute("aria-labelledby", heading.id);

      monthCards = document.createElement("div");
      monthCards.className = "cards";
      group.appendChild(heading);
      group.appendChild(monthCards);
      target.appendChild(group);
      monthGroups.set(monthKey, monthCards);
    }

    const card = document.createElement("article");
    card.className = `card ${isPast ? "card-past" : "card-upcoming"}`;
    card.style.animationDelay = `${Math.min(index * 40, 240)}ms`;
    card.innerHTML = buildSeminarCardMarkup(seminar, isPast);

    monthCards.appendChild(card);
  });
}

function renderHeroFeature(upcoming, archivedCount) {
  if (!heroFeatureCard || !heroSeriesCount || !heroNextDate) {
    return;
  }

  heroSeriesCount.textContent = buildSeriesCountLabel(upcoming.length, archivedCount);

  if (upcoming.length === 0) {
    heroNextDate.textContent = "To be announced";
    heroFeatureCard.innerHTML = `
      <div class="hero-feature-empty">
        <p id="hero-feature-title" class="hero-feature-title">The next seminar will be announced here.</p>
        <p class="hero-feature-copy">Please check back for the next confirmed date.</p>
      </div>
    `;
    return;
  }

  const seminar = upcoming[0];
  const metaPieces = buildMetaPieces(seminar, false);
  const actionsHtml = buildActionsMarkup(seminar, false);
  const speakerNameHtml = buildSpeakerNameHtml(seminar);
  const speakerDetailHtml = seminar.speakerDetail
    ? `<p class="speaker-detail">${escapeHtml(seminar.speakerDetail)}</p>`
    : "";
  const abstractHtml = seminar.abstract
    ? `<p class="hero-feature-copy">${escapeHtml(seminar.abstract)}</p>`
    : `<p class="hero-feature-copy">A live seminar in the current series.</p>`;

  heroNextDate.textContent = formatHeroDate(seminar.startAt, seminar.timeZone);
  heroFeatureCard.innerHTML = `
    <p id="hero-feature-title" class="hero-feature-title">${escapeHtml(seminar.title)}</p>
    <p class="speaker">${speakerNameHtml}</p>
    ${speakerDetailHtml}
    <div class="hero-feature-meta">${metaPieces.join(" &middot; ")}</div>
    ${abstractHtml}
    ${actionsHtml ? `<div class="hero-feature-actions">${actionsHtml}</div>` : ""}
  `;
}

function buildSeminarCardMarkup(seminar, isPast) {
  const metaPieces = buildMetaPieces(seminar, isPast);
  const speakerNameHtml = buildSpeakerNameHtml(seminar);
  const speakerDetailHtml = seminar.speakerDetail
    ? `<p class="speaker-detail">${escapeHtml(seminar.speakerDetail)}</p>`
    : "";
  const abstractHtml = seminar.abstract
    ? `<p class="abstract">${escapeHtml(seminar.abstract)}</p>`
    : "";
  const actionsHtml = buildActionsMarkup(seminar, isPast);

  return `
    <div class="card-shell">
      ${buildDateBlockMarkup(seminar)}
      <div class="card-main">
        <span class="chip">${isPast ? "Archive" : buildRelativeLabel(seminar)}</span>
        <h4>${escapeHtml(seminar.title)}</h4>
        <p class="speaker">${speakerNameHtml}</p>
        ${speakerDetailHtml}
        <div class="card-meta">${metaPieces.join(" &middot; ")}</div>
        ${abstractHtml}
        ${actionsHtml ? `<div class="card-actions">${actionsHtml}</div>` : ""}
      </div>
    </div>
  `;
}

function buildSpeakerNameHtml(seminar) {
  if (seminar.speakerPortfolio) {
    return `<a class="speaker-portfolio-link" href="${escapeAttribute(
      seminar.speakerPortfolio
    )}" target="_blank" rel="noopener noreferrer">${escapeHtml(seminar.speaker)}</a>`;
  }

  return escapeHtml(seminar.speaker);
}

function buildMetaPieces(seminar, isPast) {
  const dateLabel = formatEventDate(seminar.startAt, seminar.timeZone);
  const timeLabel = seminar.hasTime
    ? buildTimeLabel(seminar.startTime, seminar.endTime, seminar.timeZoneLabel)
    : `All day ${seminar.timeZoneLabel}`;
  const metaPieces = [escapeHtml(dateLabel), escapeHtml(timeLabel)];

  if (seminar.venue) {
    metaPieces.push(escapeHtml(seminar.venue));
  }

  if (!isPast) {
    metaPieces.push(escapeHtml(buildCountdownLabel(seminar.startAt)));
  }

  return metaPieces;
}

function buildActionsMarkup(seminar, isPast) {
  const actions = [];

  if (!isPast && seminar.registerLink) {
    actions.push(
      `<a class="register-link" href="${escapeAttribute(seminar.registerLink)}" target="_blank" rel="noopener noreferrer">Join Meeting Online</a>`
    );
  }

  actions.push(
    `<a class="calendar-link" href="${escapeAttribute(
      buildIcsDataUrl(seminar)
    )}" download="${escapeAttribute(buildIcsFileName(seminar))}">Add to Calendar</a>`
  );

  return actions.join("");
}

function buildDateBlockMarkup(seminar) {
  const parts = formatDateBlockParts(seminar.startAt, seminar.timeZone);

  return `
    <div class="card-date-block" aria-hidden="true">
      <span class="card-date-month">${escapeHtml(parts.month)}</span>
      <span class="card-date-day">${escapeHtml(parts.day)}</span>
      <span class="card-date-weekday">${escapeHtml(parts.weekday)}</span>
    </div>
  `;
}

function buildSeriesCountLabel(upcomingCount, archivedCount) {
  const parts = [];

  if (upcomingCount > 0) {
    parts.push(`${upcomingCount} upcoming`);
  }

  if (archivedCount > 0) {
    parts.push(`${archivedCount} archived`);
  }

  if (parts.length > 0) {
    return parts.join(" / ");
  }

  return "Schedule pending";
}

function buildRelativeLabel(seminar) {
  const msUntilStart = seminar.startAt.getTime() - Date.now();
  const dayDiff = Math.floor(msUntilStart / (24 * 60 * 60 * 1000));

  if (dayDiff <= 0) {
    return "Next Up";
  }
  if (dayDiff === 1) {
    return "Tomorrow";
  }
  if (dayDiff < 7) {
    return `In ${dayDiff} days`;
  }
  if (dayDiff < 14) {
    return "Next Week";
  }

  return "Upcoming";
}

function buildCountdownLabel(startAt) {
  const diffMs = startAt.getTime() - Date.now();
  const dayDiff = Math.round(diffMs / (24 * 60 * 60 * 1000));

  if (dayDiff <= 0) {
    return "Happening soon";
  }
  if (dayDiff === 1) {
    return "Starts tomorrow";
  }
  if (dayDiff < 7) {
    return `Starts in ${dayDiff} days`;
  }
  if (dayDiff < 30) {
    return `Starts in ${Math.round(dayDiff / 7)} week${Math.round(dayDiff / 7) === 1 ? "" : "s"}`;
  }

  return "Later this term";
}

function formatDateBlockParts(date, timeZone) {
  return {
    month: new Intl.DateTimeFormat(undefined, {
      timeZone,
      month: "short",
    }).format(date),
    day: new Intl.DateTimeFormat(undefined, {
      timeZone,
      day: "numeric",
    }).format(date),
    weekday: new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: "short",
    }).format(date),
  };
}

function formatHeroDate(date, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatEventDate(date, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function buildTimeLabel(startTime, endTime, timeZoneLabel) {
  if (endTime) {
    return `${startTime}-${endTime} ${timeZoneLabel}`;
  }
  return `${startTime} ${timeZoneLabel}`;
}

function buildIcsDataUrl(seminar) {
  const content = buildIcsContent(seminar);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`;
}

function buildIcsFileName(seminar) {
  const datePart = seminar.dateIso || formatDateOnlyUtc(seminar.startAt);
  const titlePart = slugify(seminar.title);
  return `${datePart}-${titlePart}.ics`;
}

function buildIcsContent(seminar) {
  const uid = `${seminar.startAt.getTime()}-${slugify(seminar.title)}@early-modern-lab`;
  const dtstamp = formatIcsUtc(new Date());

  const descriptionParts = [`Speaker: ${seminar.speaker}`];
  if (seminar.speakerDetail) {
    descriptionParts.push(`Speaker details: ${seminar.speakerDetail}`);
  }
  if (seminar.abstract) {
    descriptionParts.push(`Abstract: ${seminar.abstract}`);
  }
  if (seminar.registerLink) {
    descriptionParts.push(`Link: ${seminar.registerLink}`);
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Early Modern Lab Seminars//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${dtstamp}`,
  ];

  if (seminar.hasTime) {
    lines.push(`DTSTART:${formatIcsUtc(seminar.startAt)}`);
    lines.push(`DTEND:${formatIcsUtc(seminar.endAt)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDateInZone(seminar.startAt, seminar.timeZone)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDateInZone(seminar.endAt, seminar.timeZone)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(seminar.title)}`);
  lines.push(`DESCRIPTION:${escapeIcsText(descriptionParts.join("\n\n"))}`);

  if (seminar.venue) {
    lines.push(`LOCATION:${escapeIcsText(seminar.venue)}`);
  }
  if (seminar.registerLink) {
    lines.push(`URL:${escapeIcsText(seminar.registerLink)}`);
  }

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return `${lines.join("\r\n")}\r\n`;
}

function formatIcsUtc(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatIcsDateInZone(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
}

function formatDateOnlyUtc(date) {
  return date.toISOString().slice(0, 10);
}

function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "seminar";
}

function escapeHtml(value) {
  const text = String(value ?? "");
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
