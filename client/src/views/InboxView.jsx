import { InboxWorkspace } from './InboxWorkspace.jsx';

// LeadOS owns this route wrapper and always uses LeadOS APIs, events, and storage.
export const InboxView = () => <InboxWorkspace mode="leados" />;
