import {
  Brain,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  Copy,
  ExternalLink,
  File,
  FileCode2,
  FileCog,
  FileJson,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Globe2,
  History,
  Info,
  Keyboard,
  Minus,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  Undo2,
  User,
  Wrench,
  X,
  type LucideProps,
} from "lucide-react";

const ICONS = {
  brain: Brain,
  braces: Braces,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  circle: Circle,
  circleAlert: CircleAlert,
  circleCheck: CircleCheck,
  circleDot: CircleDot,
  circleHelp: CircleHelp,
  copy: Copy,
  externalLink: ExternalLink,
  file: File,
  fileCode2: FileCode2,
  fileCog: FileCog,
  fileJson: FileJson,
  fileText: FileText,
  folder: Folder,
  folderPlus: FolderPlus,
  gitBranch: GitBranch,
  globe: Globe2,
  history: History,
  info: Info,
  keyboard: Keyboard,
  minus: Minus,
  messageSquare: MessageSquare,
  panelLeft: PanelLeft,
  panelRight: PanelRight,
  pencil: Pencil,
  pin: Pin,
  play: Play,
  plus: Plus,
  save: Save,
  search: Search,
  settings: Settings2,
  shieldAlert: ShieldAlert,
  trash: Trash2,
  undo: Undo2,
  user: User,
  wrench: Wrench,
  x: X,
} as const;

export type AppIconName = keyof typeof ICONS;
export type AppIconSize = "xs" | "sm" | "md" | "lg" | "xl";

export const APP_ICON_SIZES: Record<AppIconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export interface AppIconProps extends Omit<LucideProps, "size"> {
  name: AppIconName;
  size?: AppIconSize | number;
  decorative?: boolean;
}

export function AppIcon({
  name,
  size = "md",
  strokeWidth = 1.5,
  decorative = true,
  "aria-label": ariaLabel,
  ...props
}: AppIconProps) {
  const Icon = ICONS[name];
  const pixelSize = typeof size === "number" ? size : APP_ICON_SIZES[size];

  return (
    <Icon
      {...props}
      size={pixelSize}
      strokeWidth={strokeWidth}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel || !decorative ? undefined : true}
    />
  );
}
