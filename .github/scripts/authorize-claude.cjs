module.exports = async function authorizeClaude({ github, context, triggeringActor }) {
  const { payload, repo, actor, eventName } = context;
  const comment = payload.comment;
  const issue = payload.issue;
  if (
    eventName !== 'issue_comment' ||
    payload.action !== 'created' ||
    comment?.user?.type !== 'User' ||
    typeof comment.body !== 'string' ||
    !comment.body.includes('@claude') ||
    !Number.isSafeInteger(issue?.number) ||
    issue.number <= 0
  ) {
    return 'none';
  }

  const actors = [comment.user.login, actor, triggeringActor];
  if (actors.some((login) => typeof login !== 'string' || !login.trim())) {
    return 'none';
  }
  for (const username of new Set(actors.map((login) => login.toLowerCase()))) {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      ...repo,
      username,
    });
    if (!['write', 'maintain', 'admin'].includes(data.permission)) {
      return 'none';
    }
  }

  const mode = comment.body.trim() === '@claude' ? 'review' : 'custom';
  if (!issue.pull_request) {
    return mode === 'custom' ? mode : 'none';
  }

  const { data: pullRequest } = await github.rest.pulls.get({
    ...repo,
    pull_number: issue.number,
  });
  const repository = `${repo.owner}/${repo.repo}`.toLowerCase();
  if (pullRequest.base?.repo?.full_name?.toLowerCase() !== repository) {
    return 'none';
  }
  if (
    mode === 'custom' &&
    (pullRequest.head?.repo?.full_name?.toLowerCase() !== repository ||
      typeof pullRequest.head?.ref !== 'string' ||
      !pullRequest.head.ref.trim())
  ) {
    return 'none';
  }
  return mode;
};
