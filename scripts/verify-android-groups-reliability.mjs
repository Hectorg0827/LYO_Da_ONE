import { readFileSync } from 'node:fs';

const groups = readFileSync(
  new URL('../android/app/src/main/java/com/lyo/app/ui/screens/community/GroupsScreen.kt', import.meta.url),
  'utf8',
);

function requireText(expected, label) {
  if (!groups.includes(expected)) {
    throw new Error(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

function rejectText(forbidden, label) {
  if (groups.includes(forbidden)) {
    throw new Error(`${label}: forbidden ${JSON.stringify(forbidden)}`);
  }
}

for (const [expected, label] of [
  ['var loaded by remember', 'confirmed-load state'],
  ['var loadError by remember', 'load error state'],
  ['var actionError by remember', 'membership action error state'],
  ['var pendingGroupId by remember', 'single membership pending guard'],
  ['loaded && groups.isEmpty()', 'confirmed empty state'],
  ['loadGroups(preserveVisibleContent = groups.isNotEmpty())', 'refresh preserves visible groups'],
  ['if (joined) {\n                    val response = ApiClient.api.leaveGroup(id)', 'real leave request'],
  ['ApiClient.api.joinGroup(id)', 'real join request'],
  ['.onSuccess {\n                loadGroups(preserveVisibleContent = true)', 'authoritative refresh after success'],
  ['actionError = groupFailureMessage(', 'visible membership failure'],
  ['enabled = pendingGroupId == null', 'parallel membership writes blocked'],
  ['is HttpException -> when (error.code())', 'classified API errors'],
  ['is IOException -> "Check your connection and retry."', 'classified connectivity error'],
]) {
  requireText(expected, label);
}

const requestStart = groups.indexOf('runCatching {\n                if (joined)');
const successStart = groups.indexOf('.onSuccess {', requestStart);
const refreshStart = groups.indexOf('loadGroups(preserveVisibleContent = true)', successStart);
if (requestStart < 0 || successStart < requestStart || refreshStart < successStart) {
  throw new Error('Membership state must refresh only after backend success.');
}

for (const forbidden of [
  'joinedIds = joinedIds - id',
  'joinedIds = joinedIds + id',
  '.onFailure { joinedIds =',
  '\n            groups.isEmpty() -> EmptyState(',
]) {
  rejectText(forbidden, 'Android Study Groups reliability');
}

console.log('Android Study Groups keeps membership authoritative and exposes load/write failures.');
