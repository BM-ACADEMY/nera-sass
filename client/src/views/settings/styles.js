import { C } from '../../constants/theme.js';

export const inputStyle = (editable = true) => ({
  width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7,
  color: editable ? C.text : C.muted, padding: '9px 11px', fontSize: 12, outline: 'none',
});
