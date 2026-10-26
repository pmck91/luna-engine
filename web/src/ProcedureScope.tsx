import { createContext } from 'react';
import type { Procedure, Project } from './contracts';

/** The inspector projects the same lexical scope as its Blockly workspace. */
export const ProcedureScope = createContext<{
  project: Project;
  procedure?: Procedure;
  scriptId: string;
} | null>(null);
