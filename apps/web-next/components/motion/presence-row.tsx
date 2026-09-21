'use client';

import { motion } from 'motion/react';
import type { HTMLMotionProps } from 'motion/react';

export function PresenceRow({ className, children, ...props }: HTMLMotionProps<'tr'>) {
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className={className}
      {...props}
    >
      {children}
    </motion.tr>
  );
}
