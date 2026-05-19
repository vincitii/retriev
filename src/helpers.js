import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.entry';
import JSZip from 'jszip';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export function loadAppState() {
  try {
    const raw = window.localStorage.getItem('paStudyAppState');
    if (!raw) return null;
    const parsed = JSON.parse(raw) || {};
    return {
      theme: parsed.theme || 'dark',
      courses: Array.isArray(parsed.courses) ? parsed.courses : [],
      exams: Array.isArray(parsed.exams) ? parsed.exams : [],
      schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      availability: parsed.availability || { wake: '07:00', sleep: '23:00', blocked: [] },
      uploadDraftNotes: Array.isArray(parsed.uploadDraftNotes) ? parsed.uploadDraftNotes : [],
      ...parsed,
    };
  } catch (error) {
    console.warn('Unable to load app state:', error);
    return null;
  }
}

export function saveAppState(state) {
  try {
    window.localStorage.setItem('paStudyAppState', JSON.stringify(state));
  } catch (error) {
    console.warn('Unable to save app state:', error);
  }
}

export function formatDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function compactDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toISOString().slice(0, 10);
}

export function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];

  for (let page = 1; page <= pdf.numPages; page += 1) {
    const pageObj = await pdf.getPage(page);
    const textContent = await pageObj.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(' ');
    pageTexts.push(pageText);
  }

  return pageTexts.join('\n\n');
}

export async function extractTextFromPptx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files).filter((p) => p.match(/^ppt\/slides\/slide\d+\.xml$/));
  slideFiles.sort((a, b) => {
    const na = parseInt(a.match(/slide(\d+)\.xml$/)[1], 10);
    const nb = parseInt(b.match(/slide(\d+)\.xml$/)[1], 10);
    return na - nb;
  });

  const pageTexts = [];
  for (const slidePath of slideFiles) {
    const content = await zip.files[slidePath].async('string');
    // extract text nodes <a:t>text</a:t>
    const parts = [];
    const re = /<a:t[^>]*>(.*?)<\/a:t>/gms;
    let m;
    while ((m = re.exec(content)) !== null) {
      parts.push(m[1].replace(/\s+/g, ' ').trim());
    }
    const slideText = parts.join(' ');
    if (slideText) pageTexts.push(slideText);
  }

  return pageTexts.join('\n\n');
}

export function countDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const delta = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return Math.max(0, delta);
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTimeString(min) {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function subtractIntervals(available, blocked) {
  const result = [];
  for (const a of available) {
    let spans = [a];
    for (const b of blocked) {
      const newSpans = [];
      for (const s of spans) {
        if (b.end <= s.start || b.start >= s.end) {
          newSpans.push(s);
        } else {
          if (b.start > s.start) newSpans.push({ start: s.start, end: Math.max(s.start, b.start) });
          if (b.end < s.end) newSpans.push({ start: Math.min(s.end, b.end), end: s.end });
        }
      }
      spans = newSpans;
    }
    for (const s of spans) {
      if (s.end - s.start >= 30) result.push(s);
    }
  }
  return result;
}

export function buildStudySchedule(exams, courses, availability) {
  if (!exams || !exams.length || !courses || !courses.length) return [];

  const today = new Date();
  const futureExams = exams
    .map((exam) => ({ ...exam, date: new Date(exam.date) }))
    .filter((exam) => exam.date >= today)
    .sort((a, b) => a.date - b.date);

  if (!futureExams.length) return [];

  const nearestExam = futureExams[0];
  const daysToExam = countDaysBetween(today, nearestExam.date);
  const sessionsPerDay = daysToExam <= 12 ? 2 : 1;
  const schedule = [];

  const defaultAvailability = availability || { wake: '07:00', sleep: '23:00', blocked: [] };

  for (let offset = 0; offset <= daysToExam; offset += 1) {
    const sessionDate = new Date(today);
    sessionDate.setDate(sessionDate.getDate() + offset);
    const weekday = sessionDate.toLocaleString(undefined, { weekday: 'long' });

    const wakeMin = parseTimeToMinutes(defaultAvailability.wake || '07:00');
    const sleepMin = parseTimeToMinutes(defaultAvailability.sleep || '23:00');
    const available = [{ start: wakeMin, end: sleepMin }];

    const blocked = (defaultAvailability.blocked || [])
      .filter((b) => !b.days || b.days.length === 0 || b.days.includes(weekday))
      .map((b) => ({ start: parseTimeToMinutes(b.start), end: parseTimeToMinutes(b.end) }));

    const freeSpans = subtractIntervals(available, blocked);

    const candidateStarts = [];
    const sessionLength = 90;
    const sessionGap = 30;
    const step = sessionLength + sessionGap;
    for (const span of freeSpans) {
      for (let t = span.start; t + sessionLength <= span.end; t += step) {
        candidateStarts.push(t);
      }
    }

    const dayStarts = candidateStarts.slice(0, sessionsPerDay);

    for (const startMin of dayStarts) {
      const endMin = startMin + 90;
      const startStr = minutesToTimeString(startMin);
      const endStr = minutesToTimeString(endMin);

      // Each session covers all active exams interleaved — one segment per exam
      const segments = futureExams.map((exam) => ({ examName: exam.name, examId: exam.id }));

      schedule.push({
        id: `session-${offset}-${startStr}`,
        date: compactDate(sessionDate.toISOString()),
        start: startStr,
        end: endStr,
        courses: futureExams.map((e) => e.name),
        timeRange: `${formatDateWithDay(sessionDate.toISOString())} ${formatTime12(startStr)} – ${formatTime12(endStr)}`,
        summary: `Interleaved study block covering ${futureExams.map((e) => e.name).join(', ')}.`,
        examName: 'Study Block',
        segments,
      });
    }
  }

  return schedule;
}

function courseUrgency(course, examDate) {
  const dueWeight = course.nextDue ? Math.max(0, 30 - countDaysBetween(new Date(), course.nextDue)) : 0;
  const performancePenalty = (course.stats.missed || 0) * 3 + (course.stats.guessed || 0) * 2 - (course.stats.easy || 0);
  const examBonus = Math.max(0, 30 - countDaysBetween(new Date(), examDate));
  return dueWeight + performancePenalty + examBonus;
}

export function formatTime12(timeStr) {
  if (!timeStr) return '';
  const [hour, minute] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(hour);
  d.setMinutes(minute);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function buildSessionSummary(courses, examDate) {
  const courseList = courses.join(', ');
  const examCountdown = countDaysBetween(new Date(), examDate);
  if (examCountdown <= 7) {
    return `High urgency review before the exam. Focus on ${courseList} with interleaved recall and active application.`;
  }
  return `Build fluency on ${courseList} with focused practice, clinical examples, and retrieval practice.`;
}

export function computeNextReviewDate(rating, examDates) {
  const today = new Date();
  const nearestExam = (examDates || [])
    .map((exam) => new Date(exam.date))
    .filter((date) => date >= today)
    .sort((a, b) => a - b)[0];

  const daysUntilExam = nearestExam ? Math.max(1, countDaysBetween(today, nearestExam)) : 30;
  let interval;

  switch (rating) {
    case 'easy':
      interval = daysUntilExam <= 7 ? Math.max(1, Math.round(daysUntilExam / 2)) : 7;
      interval = Math.min(interval, 14);
      break;
    case 'hard':
      interval = daysUntilExam <= 4 ? 1 : 2;
      break;
    case 'missed':
    case 'guessed':
      interval = 1;
      break;
    default:
      interval = 2;
  }

  const next = new Date(today);
  next.setDate(next.getDate() + interval);
  return compactDate(next.toISOString());
}

export function buildCourseSummary(course) {
  const urgent = (course.stats.missed || 0) + (course.stats.guessed || 0);
  return urgent > 1
    ? `Weak spot: focus on this course with active recall and concrete clinical examples.`
    : `Strengthen this course with interleaved practice, retrieval cues, and useful analogies.`;
}

export function safeParseJson(text) {
  if (!text) return null;

  const trimmed = text.trim();
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');

  if (arrayStart !== -1 && arrayEnd !== -1 && arrayStart < arrayEnd) {
    const candidate = trimmed.slice(arrayStart, arrayEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // continue to object parse fallback
    }
  }

  if (objectStart !== -1 && objectEnd !== -1 && objectStart < objectEnd) {
    const candidate = trimmed.slice(objectStart, objectEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch (error) {
      return null;
    }
  }

  return null;
}

export function parseSimpleCourses(text) {
  const lines = text
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);

  const titles = lines
    .slice(0, 20)
    .map((line) => line.replace(/^\d+\.|^-|^\*|^Topic:|^Course:/i, '').trim())
    .filter((line) => line.length > 8)
    .slice(0, 10);

  return titles.map((title, index) => ({
    id: `manual-course-${Date.now()}-${index}`,
    title,
    chapter: '',
    source: 'Legacy parse',
    keyConcepts: [],
    assets: {
      practiceQuestion: '',
      answerExplanation: '',
      clinicalExample: '',
      mnemonic: '',
      videoSuggestions: '',
      conceptMap: '',
      summary: '',
      analogy: '',
      dualCoding: '',
    },
    stats: { easy: 0, hard: 0, missed: 0, guessed: 0, totalReviews: 0 },
    nextDue: compactDate(new Date().toISOString()),
    confidenceHistory: [],
    createdAt: compactDate(new Date().toISOString()),
  }));
}

export function formatDateWithDay(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
