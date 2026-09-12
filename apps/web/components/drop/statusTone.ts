import type { DropStatus } from '@bitedrop/core';

export type BadgeTone = 'accent' | 'amber' | 'muted' | 'outline' | 'dashed';

const STATUS_TONES: Record<DropStatus, BadgeTone> = {
  new: 'accent',
  coming_soon: 'outline',
  limited_time: 'amber',
  returning: 'outline',
  discontinued: 'muted',
  rumored: 'dashed',
};

export function statusTone(status: DropStatus): BadgeTone {
  return STATUS_TONES[status];
}
