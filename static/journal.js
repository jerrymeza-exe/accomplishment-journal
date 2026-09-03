/* Browser-side journal rules and persistence for the GitHub Pages build. */

export const EMPTY_JOURNAL = { version: 3, projects: [], achievements: [] };

const STORAGE_KEY = 'accomplishment-journal-v3';
const RECOVERY_PREFIX = `${STORAGE_KEY}-recovery-`;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredText(value, message) {
  const result = cleanText(value);
  if (!result) throw new Error(message);
  return result;
}

function calendarDate(value) {
  const result = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error('That date could not be read.');
  const [year, month, day] = result.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('That date could not be read.');
  }
  return result;
}

function tags(value) {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    throw new Error('Those tags could not be read.');
  }
  return [...new Set(value.map(cleanText).filter(Boolean))];
}

function id(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

function projectIn(state, projectId) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error('That project is no longer in this journal.');
  return project;
}

function entryIn(state, entryId) {
  const entry = state.achievements.find((candidate) => candidate.id === entryId);
  if (!entry) throw new Error('That entry is no longer in this journal.');
  return entry;
}

function entryFields(state, operation, stamp) {
  const project = projectIn(state, cleanText(operation.projectId));
  return {
    projectId: project.id,
    title: requiredText(operation.title, 'Add a title and a short log entry before saving.'),
    date: calendarDate(operation.date),
    milestone: cleanText(operation.milestone),
    markdown: requiredText(operation.markdown, 'Add a title and a short log entry before saving.'),
    updatedAt: stamp,
  };
}

function touchProject(state, projectId, stamp) {
  const project = projectIn(state, projectId);
  project.updatedAt = stamp;
}

export function applyOperation(current, operation) {
  const state = clone(current);
  const stamp = new Date().toISOString();
  let createdId;

  switch (operation?.op) {
    case 'create_project': {
      createdId = id('project');
      state.projects.push({
        id: createdId,
        name: requiredText(operation.name, 'Add a project name before saving.'),
        description: cleanText(operation.description),
        startedOn: calendarDate(operation.startedOn),
        tags: tags(operation.tags),
        updatedAt: stamp,
      });
      break;
    }
    case 'update_project': {
      const project = projectIn(state, cleanText(operation.id));
      Object.assign(project, {
        name: requiredText(operation.name, 'Add a project name before saving.'),
        description: cleanText(operation.description),
        startedOn: calendarDate(operation.startedOn),
        tags: tags(operation.tags),
        updatedAt: stamp,
      });
      break;
    }
    case 'delete_project': {
      const project = projectIn(state, cleanText(operation.id));
      state.projects = state.projects.filter((candidate) => candidate.id !== project.id);
      state.achievements = state.achievements.filter((entry) => entry.projectId !== project.id);
      break;
    }
    case 'record_entry': {
      createdId = id('entry');
      const fields = entryFields(state, operation, stamp);
      state.achievements.unshift({ id: createdId, createdAt: stamp, ...fields });
      touchProject(state, fields.projectId, stamp);
      break;
    }
    case 'update_entry': {
      const entry = entryIn(state, cleanText(operation.id));
      const fields = entryFields(state, operation, stamp);
      Object.assign(entry, fields);
      touchProject(state, fields.projectId, stamp);
      break;
    }
    case 'delete_entry': {
      const entry = entryIn(state, cleanText(operation.id));
      state.achievements = state.achievements.filter((candidate) => candidate.id !== entry.id);
      break;
    }
    case 'move_entry': {
      const entry = entryIn(state, cleanText(operation.id));
      if (operation.direction !== -1 && operation.direction !== 1) {
        throw new Error('An entry can only move up or down.');
      }
      const indexes = state.achievements
        .map((candidate, index) => candidate.projectId === entry.projectId ? index : -1)
        .filter((index) => index >= 0);
      const position = indexes.indexOf(state.achievements.indexOf(entry));
      const neighbour = position + operation.direction;
      if (neighbour >= 0 && neighbour < indexes.length) {
        const left = indexes[position];
        const right = indexes[neighbour];
        [state.achievements[left], state.achievements[right]] = [state.achievements[right], state.achievements[left]];
      }
      break;
    }
    default:
      throw new Error(`Unknown operation: ${String(operation?.op)}`);
  }

  return { state, createdId };
}

function normalizedProject(value) {
  return {
    id: requiredText(value?.id, 'Backup has an invalid project ID.'),
    name: requiredText(value?.name, 'Backup has an invalid project name.'),
    description: cleanText(value?.description),
    startedOn: calendarDate(value?.startedOn),
    tags: tags(value?.tags ?? []),
    updatedAt: requiredText(value?.updatedAt, 'Backup has an invalid project update date.'),
  };
}

function normalizedEntry(value, projectIds) {
  const projectId = requiredText(value?.projectId, 'Backup has an invalid accomplishment project.');
  if (!projectIds.has(projectId)) throw new Error('Backup includes an accomplishment with a missing project.');
  return {
    id: requiredText(value?.id, 'Backup has an invalid accomplishment ID.'),
    projectId,
    title: requiredText(value?.title, 'Backup has an invalid accomplishment title.'),
    date: calendarDate(value?.date),
    /* Journals written before the rename still label this `category`.
       Reading both means an older file keeps its milestones. */
    milestone: cleanText(value?.milestone) || cleanText(value?.category),
    markdown: cleanText(value?.markdown),
    createdAt: requiredText(value?.createdAt, 'Backup has an invalid accomplishment creation date.'),
    updatedAt: requiredText(value?.updatedAt, 'Backup has an invalid accomplishment update date.'),
  };
}

/* Fold a structured v1 accomplishment into a Markdown body. Mirrors
   `tracker._legacy_markdown`, down to the section order and wording. */
function legacyMarkdown(item, description) {
  const sections = [description];
  const impact = cleanText(item?.impact);
  if (impact) sections.push(`**Impact**\n\n${impact}`);
  const skills = Array.isArray(item?.skills)
    ? item.skills.filter((skill) => typeof skill === 'string').map(cleanText).filter(Boolean)
    : [];
  if (skills.length) sections.push(`- Tools / skills: ${skills.join(', ')}`);
  const notes = cleanText(item?.notes);
  if (notes) sections.push(`> ${notes}`);
  return sections.filter(Boolean).join('\n\n');
}

/* One v1 achievement, in the shape the current journal keeps. The label this
   version called `category` is the milestone; the structured description,
   impact, skills and notes become the entry's writing. */
function migratedLegacyEntry(value, projectIds) {
  const projectId = requiredText(value?.projectId, 'Backup has an invalid accomplishment project.');
  if (!projectIds.has(projectId)) throw new Error('Backup includes an achievement with a missing project.');
  const description = requiredText(value?.description, 'Backup has an invalid achievement description.');
  return {
    id: requiredText(value?.id, 'Backup has an invalid achievement ID.'),
    projectId,
    title: requiredText(value?.title, 'Backup has an invalid achievement title.'),
    date: calendarDate(value?.date),
    milestone: cleanText(value?.category) || 'General',
    markdown: legacyMarkdown(value, description),
    createdAt: requiredText(value?.createdAt, 'Backup has an invalid achievement creation date.'),
    updatedAt: requiredText(value?.updatedAt, 'Backup has an invalid achievement update date.'),
  };
}

export function normalizeBackup(candidate) {
  const value = candidate?.data ?? candidate;
  if (!value || typeof value !== 'object') {
    throw new Error('This is not a compatible Accomplishment Journal backup.');
  }
  /* The hosted build is the only journal some people have, so it reads the
     older formats the Python app reads rather than turning them away. */
  if (![1, 2, 3].includes(value.version)) {
    throw new Error('This backup was made by an incompatible journal version.');
  }
  if (!Array.isArray(value.projects) || !Array.isArray(value.achievements)) {
    throw new Error('This is not a compatible Accomplishment Journal backup.');
  }
  const projects = value.projects.map(normalizedProject);
  const projectIds = new Set(projects.map((project) => project.id));
  if (projectIds.size !== projects.length) throw new Error('Backup includes duplicate project IDs.');
  const achievements = value.achievements.map((entry) => value.version === 1
    ? migratedLegacyEntry(entry, projectIds)
    : normalizedEntry(entry, projectIds));
  const entryIds = new Set(achievements.map((entry) => entry.id));
  if (entryIds.size !== achievements.length) throw new Error('Backup includes duplicate accomplishment IDs.');
  return { version: 3, projects, achievements };
}

export function loadJournal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? normalizeBackup(JSON.parse(raw)) : clone(EMPTY_JOURNAL);
}

export function saveJournal(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function quarantineJournal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== null) localStorage.setItem(`${RECOVERY_PREFIX}${Date.now()}`, raw);
  localStorage.removeItem(STORAGE_KEY);
  return clone(EMPTY_JOURNAL);
}

export function backupBlob(state) {
  const payload = { app: 'Accomplishment Journal', exportedAt: new Date().toISOString(), data: state };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export function projectCsv(state, projectId) {
  const project = projectIn(state, projectId);
  const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = state.achievements
    .filter((entry) => entry.projectId === projectId)
    .map((entry) => [project.name, entry.date, entry.milestone, entry.title, entry.markdown].map(escape).join(','));
  const csv = ['project,date,milestone,title,markdown', ...rows].join('\r\n');
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  return { name: `${slug}-log.csv`, blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }) };
}
