import {
  Activity,
  Atom,
  Baby,
  BatteryCharging,
  Binary,
  Bone,
  Brain,
  BrainCircuit,
  Braces,
  Briefcase,
  Building2,
  Calculator,
  Car,
  CircuitBoard,
  Cloud,
  Cog,
  Compass,
  Construction,
  Cpu,
  Database,
  Droplets,
  Factory,
  FlaskConical,
  Flame,
  Gauge,
  Sparkles,
  GraduationCap,
  HardHat,
  HeartHandshake,
  HeartPulse,
  Landmark,
  Megaphone,
  Microscope,
  Mountain,
  Network,
  Pill,
  Plane,
  Plug,
  RadioTower,
  Ruler,
  Scale,
  Server,
  ShieldCheck,
  Shapes,
  Signal,
  Stethoscope,
  Sun,
  Syringe,
  Terminal,
  TrendingUp,
  Truck,
  Users,
  Waypoints,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { InterviewType } from './types';

export type Field =
  | 'Computer & IT'
  | 'Electrical & Electronics'
  | 'Mechanical'
  | 'Civil'
  | 'Medical & Healthcare'
  | 'Business & Management'
  | 'Soft skills';

export interface FieldMeta {
  name: Field;
  short: string;
  icon: LucideIcon;
  hue: number;
  defaultRole: string;
  roles: string[];
}

export const FIELDS: FieldMeta[] = [
  {
    name: 'Computer & IT',
    short: 'Computer',
    icon: Cpu,
    hue: 225,
    defaultRole: 'Software Engineer',
    roles: ['Software Engineer', 'Frontend Developer', 'Backend Developer', 'Full Stack Developer', 'Data Scientist', 'DevOps Engineer', 'ML Engineer', 'Network Engineer', 'QA Engineer'],
  },
  {
    name: 'Electrical & Electronics',
    short: 'Electrical',
    icon: Zap,
    hue: 48,
    defaultRole: 'Electrical Engineer',
    roles: ['Electrical Engineer', 'Electronics Engineer', 'Power Systems Engineer', 'Embedded Systems Engineer', 'VLSI Design Engineer', 'Instrumentation Engineer', 'Control Systems Engineer', 'Electrical Site Engineer'],
  },
  {
    name: 'Mechanical',
    short: 'Mechanical',
    icon: Cog,
    hue: 25,
    defaultRole: 'Mechanical Engineer',
    roles: ['Mechanical Engineer', 'Design Engineer', 'Production Engineer', 'Maintenance Engineer', 'HVAC Engineer', 'Automotive Engineer', 'Quality Engineer'],
  },
  {
    name: 'Civil',
    short: 'Civil',
    icon: HardHat,
    hue: 200,
    defaultRole: 'Civil Engineer',
    roles: ['Civil Engineer', 'Structural Engineer', 'Site Engineer', 'Geotechnical Engineer', 'Transportation Engineer', 'Quantity Surveyor', 'Project Engineer'],
  },
  {
    name: 'Medical & Healthcare',
    short: 'Medical',
    icon: Stethoscope,
    hue: 350,
    defaultRole: 'Junior Doctor',
    roles: ['Junior Doctor', 'Medical Resident', 'Medical Officer', 'Nurse', 'Pharmacist', 'Physiotherapist', 'Dentist', 'Lab Technologist', 'Medical Student (viva)'],
  },
  {
    name: 'Business & Management',
    short: 'Business',
    icon: Briefcase,
    hue: 150,
    defaultRole: 'Business Analyst',
    roles: ['Business Analyst', 'Product Manager', 'Financial Analyst', 'Accountant', 'Marketing Executive', 'Operations Manager', 'HR Executive', 'Management Trainee'],
  },
  {
    name: 'Soft skills',
    short: 'Soft skills',
    icon: HeartHandshake,
    hue: 320,
    defaultRole: '',
    roles: [],
  },
];

export const fieldMeta = (name?: string) => FIELDS.find((f) => f.name === name);

export interface Topic {
  name: string;
  field: Field;
  icon: LucideIcon;
  hue: number;
  type?: InterviewType;
  /** Optional sub-areas the interviewer should focus on. */
  focus?: string;
  custom?: boolean;
}

const t = (field: Field, items: [name: string, icon: LucideIcon, hue: number, type?: InterviewType][]): Topic[] =>
  items.map(([name, icon, hue, type]) => ({ name, field, icon, hue, ...(type ? { type } : {}) }));

export const TOPICS: Topic[] = [
  ...t('Computer & IT', [
    ['React', Atom, 190],
    ['JavaScript', Braces, 50],
    ['Python', Terminal, 210],
    ['Java & Spring', Server, 25],
    ['Data Structures & Algorithms', Binary, 160],
    ['System Design', Network, 225],
    ['Operating Systems', Cpu, 230],
    ['Computer Networks', Waypoints, 180],
    ['SQL & Databases', Database, 205],
    ['Machine Learning', BrainCircuit, 232],
    ['Cloud & DevOps', Cloud, 35],
    ['Cyber Security', ShieldCheck, 350],
  ]),
  ...t('Electrical & Electronics', [
    ['Electrical Machines', Cog, 45],
    ['Power Systems', Zap, 55],
    ['Circuit Theory', CircuitBoard, 140],
    ['Analog Electronics', Activity, 175],
    ['Digital Electronics', Binary, 200],
    ['Microcontrollers & Embedded', Cpu, 120],
    ['Control Systems', Gauge, 224],
    ['Power Electronics', BatteryCharging, 90],
    ['Communication Systems', RadioTower, 235],
    ['Electrical Safety & Installation', Plug, 15],
    ['Renewable Energy', Sun, 40],
  ]),
  ...t('Mechanical', [
    ['Thermodynamics', Flame, 15],
    ['Strength of Materials', Shapes, 210],
    ['Fluid Mechanics', Droplets, 195],
    ['Machine Design', Wrench, 30],
    ['Manufacturing Processes', Factory, 25],
    ['Heat Transfer & HVAC', Flame, 350],
    ['Automobile Engineering', Car, 0],
    ['CAD & GD&T', Compass, 230],
  ]),
  ...t('Civil', [
    ['Structural Analysis', Building2, 210],
    ['RCC & Steel Design', Construction, 30],
    ['Geotechnical Engineering', Mountain, 30],
    ['Surveying', Ruler, 160],
    ['Construction Management', HardHat, 45],
    ['Transportation Engineering', Truck, 190],
    ['Water Resources & Environment', Droplets, 185],
  ]),
  ...t('Medical & Healthcare', [
    ['Anatomy', Bone, 20],
    ['Physiology', HeartPulse, 350],
    ['Pharmacology', Pill, 230],
    ['Pathology & Microbiology', Microscope, 160],
    ['General Medicine', Stethoscope, 200],
    ['General Surgery', Syringe, 0],
    ['Pediatrics', Baby, 320],
    ['Obstetrics & Gynecology', HeartHandshake, 330],
    ['Emergency Medicine', Activity, 10],
    ['Neurology & Psychiatry', Brain, 228],
    ['Nursing', HeartPulse, 340],
    ['Biochemistry', FlaskConical, 110],
  ]),
  ...t('Business & Management', [
    ['Finance & Accounting', Calculator, 150],
    ['Marketing', Megaphone, 330],
    ['Product Management', Shapes, 225],
    ['Operations & Supply Chain', Truck, 35],
    ['Human Resources', Users, 235],
    ['Economics', TrendingUp, 140],
    ['Business Law', Scale, 220],
    ['Banking', Landmark, 45],
  ]),
  ...t('Soft skills', [
    ['Behavioral / HR', HeartHandshake, 330, 'behavioral'],
    ['Leadership & Teamwork', Users, 145, 'behavioral'],
    ['Communication', Megaphone, 190, 'behavioral'],
    ['Campus placement / Freshers', GraduationCap, 45, 'mixed'],
    ['Aviation / Cabin crew', Plane, 205, 'behavioral'],
    ['Telecom & customer support', Signal, 170, 'behavioral'],
  ]),
];

// ---------- custom topics (saved per device) ----------

export interface CustomTopic {
  name: string;
  field: string;
  focus: string;
  type?: InterviewType;
}

const CUSTOM_KEY = 'isim.customTopics';
const CUSTOM_EVENT = 'isim:custom-topics';

function readCustom(): CustomTopic[] {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
    return Array.isArray(list) ? list.filter((c) => c && typeof c.name === 'string') : [];
  } catch {
    return [];
  }
}

function writeCustom(list: CustomTopic[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    /* storage unavailable: custom topics just won't persist */
  }
  window.dispatchEvent(new Event(CUSTOM_EVENT));
}

export function useCustomTopics() {
  const [list, setList] = useState(readCustom);
  useEffect(() => {
    const sync = () => setList(readCustom());
    window.addEventListener(CUSTOM_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CUSTOM_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const save = useCallback((topic: CustomTopic) => {
    const key = topic.name.trim().toLowerCase();
    writeCustom([topic, ...readCustom().filter((c) => c.name.trim().toLowerCase() !== key)]);
  }, []);
  const remove = useCallback((name: string) => writeCustom(readCustom().filter((c) => c.name !== name)), []);
  return { list, save, remove };
}

export function customToTopic(c: CustomTopic): Topic {
  const f = fieldMeta(c.field);
  return { name: c.name, field: (f?.name ?? c.field) as Field, icon: f?.icon ?? Sparkles, hue: f?.hue ?? 215, type: c.type, focus: c.focus, custom: true };
}

/** Icon/hue for a session's topic: preset topic first, then its field, then a generic sparkle. */
export function topicMeta(name: string, field?: string): Pick<Topic, 'icon' | 'hue'> {
  const preset = TOPICS.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (preset) return preset;
  const f = fieldMeta(field) ?? fieldMeta(readCustom().find((c) => c.name.toLowerCase() === name.toLowerCase())?.field);
  return f ? { icon: f.icon, hue: f.hue } : { icon: Sparkles, hue: 230 };
}

export const ALL_ROLES = [...new Set(FIELDS.flatMap((f) => f.roles))];
