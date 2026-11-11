const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const authorize = require('./authorize-claude.cjs');

function fixture() {
  const calls = [];
  const permissions = { commenter: 'write', original: 'maintain', rerunner: 'admin' };
  const pullRequest = {
    base: { repo: { full_name: 'BitGo/advanced-wallets' } },
    head: { repo: { full_name: 'BitGo/advanced-wallets' }, ref: 'feature' },
  };
  const context = {
    eventName: 'issue_comment',
    actor: 'original',
    repo: { owner: 'BitGo', repo: 'advanced-wallets' },
    payload: {
      action: 'created',
      comment: { body: '@claude', user: { login: 'commenter', type: 'User' } },
      issue: { number: 123, pull_request: {} },
    },
  };
  const github = {
    rest: {
      repos: {
        async getCollaboratorPermissionLevel(args) {
          calls.push(['permission', args]);
          return { data: { permission: permissions[args.username] } };
        },
      },
      pulls: {
        async get(args) {
          calls.push(['pull', args]);
          return { data: pullRequest };
        },
      },
    },
  };
  return { github, context, triggeringActor: 'rerunner', calls, permissions, pullRequest };
}

for (const body of ['@claude', '  @claude  ', '\n\t@claude\r\n']) {
  test(`classifies bare mention ${JSON.stringify(body)} as review`, async () => {
    const input = fixture();
    input.context.payload.comment.body = body;
    assert.equal(await authorize(input), 'review');
    assert.deepEqual(
      input.calls.map(([kind, args]) => [kind, args.username || args.pull_number]),
      [
        ['permission', 'commenter'],
        ['permission', 'original'],
        ['permission', 'rerunner'],
        ['pull', 123],
      ],
    );
    for (const [, args] of input.calls) {
      assert.equal(args.owner, 'BitGo');
      assert.equal(args.repo, 'advanced-wallets');
    }
  });
}

for (const username of ['commenter', 'original', 'rerunner']) {
  for (const permission of ['read', 'triage', 'none', '', undefined, 'Write']) {
    test(`denies ${username} with permission ${permission}`, async () => {
      const input = fixture();
      input.permissions[username] = permission;
      assert.equal(await authorize(input), 'none');
      assert.equal(
        input.calls.some(([kind]) => kind === 'pull'),
        false,
      );
    });
  }
}

for (const permission of ['write', 'maintain', 'admin']) {
  test(`accepts current ${permission} access regardless of author association`, async () => {
    const input = fixture();
    input.context.payload.comment.author_association = 'CONTRIBUTOR';
    for (const username of Object.keys(input.permissions)) input.permissions[username] = permission;
    assert.equal(await authorize(input), 'review');
  });
}

test('organization membership does not substitute for write access', async () => {
  const input = fixture();
  input.context.payload.comment.author_association = 'MEMBER';
  input.permissions.commenter = 'read';
  assert.equal(await authorize(input), 'none');
});

test('checks identical actors once, ignoring login case', async () => {
  const input = fixture();
  input.context.actor = 'Commenter';
  input.triggeringActor = 'COMMENTER';
  assert.equal(await authorize(input), 'review');
  assert.equal(input.calls.filter(([kind]) => kind === 'permission').length, 1);
});

for (const actorField of ['commenter', 'original', 'rerunner']) {
  test(`denies missing ${actorField} identity`, async () => {
    const input = fixture();
    if (actorField === 'commenter') input.context.payload.comment.user.login = undefined;
    if (actorField === 'original') input.context.actor = '';
    if (actorField === 'rerunner') input.triggeringActor = undefined;
    assert.equal(await authorize(input), 'none');
    assert.deepEqual(input.calls, []);
  });
}

const invalidEvents = [
  [
    'inline review event',
    (input) => {
      input.context.eventName = 'pull_request_review_comment';
    },
  ],
  [
    'edited comment',
    (input) => {
      input.context.payload.action = 'edited';
    },
  ],
  [
    'bot author',
    (input) => {
      input.context.payload.comment.user.type = 'Bot';
    },
  ],
  [
    'missing comment',
    (input) => {
      delete input.context.payload.comment;
    },
  ],
  [
    'missing issue',
    (input) => {
      delete input.context.payload.issue;
    },
  ],
  [
    'non-string body',
    (input) => {
      input.context.payload.comment.body = 123;
    },
  ],
  [
    'no mention',
    (input) => {
      input.context.payload.comment.body = 'review please';
    },
  ],
  [
    'invalid number',
    (input) => {
      input.context.payload.issue.number = '123';
    },
  ],
  [
    'nonpositive number',
    (input) => {
      input.context.payload.issue.number = 0;
    },
  ],
];
for (const [name, mutate] of invalidEvents) {
  test(`denies ${name} before contacting GitHub`, async () => {
    const input = fixture();
    mutate(input);
    assert.equal(await authorize(input), 'none');
    assert.deepEqual(input.calls, []);
  });
}

for (const body of [
  '@claude fix this',
  '@claude "unterminated',
  '@claude\nreview this',
  '@claude $(false)',
]) {
  test(`classifies custom body ${JSON.stringify(body)} without shell parsing`, async () => {
    const input = fixture();
    input.context.payload.comment.body = body;
    assert.equal(await authorize(input), 'custom');
  });
}

test('allows fork reviews without authorizing custom fork commands', async () => {
  const input = fixture();
  input.pullRequest.head.repo.full_name = 'contributor/advanced-wallets';
  assert.equal(await authorize(input), 'review');
  input.context.payload.comment.body = '@claude implement this';
  assert.equal(await authorize(input), 'none');
});

test('custom commands fail closed for deleted or missing head repositories', async () => {
  const input = fixture();
  input.context.payload.comment.body = '@claude implement this';
  input.pullRequest.head = null;
  assert.equal(await authorize(input), 'none');
});

for (const ref of ['', ' ', null, undefined]) {
  test(`custom commands deny missing head branch ${JSON.stringify(ref)}`, async () => {
    const input = fixture();
    input.context.payload.comment.body = '@claude implement this';
    input.pullRequest.head.ref = ref;
    assert.equal(await authorize(input), 'none');
  });
}

test('rejects a mismatched pull request base repository', async () => {
  const input = fixture();
  input.pullRequest.base.repo.full_name = 'someone/advanced-wallets';
  assert.equal(await authorize(input), 'none');
});

test('accepts repository names regardless of case', async () => {
  const input = fixture();
  input.context.payload.comment.body = '@claude fix this';
  input.pullRequest.head.repo.full_name = 'bitgo/Advanced-Wallets';
  assert.equal(await authorize(input), 'custom');
});

test('custom issue requests work without a pull request lookup', async () => {
  const input = fixture();
  delete input.context.payload.issue.pull_request;
  input.context.payload.comment.body = '@claude fix this';
  assert.equal(await authorize(input), 'custom');
  assert.equal(
    input.calls.some(([kind]) => kind === 'pull'),
    false,
  );
  input.context.payload.comment.body = '@claude';
  assert.equal(await authorize(input), 'none');
});

for (const endpoint of ['permission', 'pull']) {
  test(`fails closed on ${endpoint} API errors`, async () => {
    const input = fixture();
    const fail = async () => {
      throw new Error('GitHub unavailable');
    };
    if (endpoint === 'permission') input.github.rest.repos.getCollaboratorPermissionLevel = fail;
    else input.github.rest.pulls.get = fail;
    await assert.rejects(authorize(input), /GitHub unavailable/);
  });
}

const workflow = readFileSync(path.join(__dirname, '../workflows/claude-code.yaml'), 'utf8');
const authorizationJob = workflow.split('  authorize:\n')[1].split('  claude-pr:\n')[0];
const inferenceJob = workflow.split('  claude-pr:\n')[1];

test('only conversation comments can trigger the credentialed workflow', () => {
  const trigger = workflow.split('\non:\n')[1].split('\njobs:\n')[0];
  assert.match(trigger, /issue_comment:\n    types: \[created\]/);
  assert.doesNotMatch(trigger, /pull_request|issues:|workflow_dispatch/);
  assert.match(workflow, /\npermissions: \{\}/);
});

test('authorization job has no AWS credentials or write permissions', () => {
  assert.doesNotMatch(
    authorizationJob,
    /id-token|: write|AWS_|configure-aws-credentials|environment:/,
  );
  assert.match(authorizationJob, /GITHUB_TRIGGERING_ACTOR/);
  assert.match(authorizationJob, /core.setOutput\('mode', mode\)/);
});

test('inference is gated on the authorization result and uses the inference environment', () => {
  assert.match(inferenceJob, /needs: authorize/);
  assert.match(
    inferenceJob,
    /if: needs.authorize.outputs.mode == 'review' \|\| needs.authorize.outputs.mode == 'custom'/,
  );
  assert.match(inferenceJob, /environment: ai-inference/);
  assert.doesNotMatch(inferenceJob, /secrets\.AWS_|aws sts assume-role|inference-role.outputs/);
});

test('both AWS credential steps use the pinned action and requested role chain', () => {
  assert.equal(
    (
      inferenceJob.match(
        /aws-actions\/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd/g,
      ) || []
    ).length,
    2,
  );
  assert.match(
    inferenceJob,
    /199765120567:role\/\$\{\{ github.event.repository.name \}\}-iam-unprotected/,
  );
  assert.doesNotMatch(inferenceJob, /iam-protected/);
  assert.match(inferenceJob, /168000258654:role\/BedrockInferenceRole/);
  assert.match(inferenceJob, /role-chaining: true/);
  assert.match(inferenceJob, /role-skip-session-tagging: true/);
  assert.equal((inferenceJob.match(/aws-region: us-west-2/g) || []).length, 2);
});

test('checkouts use the default branch without persisting tokens', () => {
  assert.equal(
    (workflow.match(/ref: \$\{\{ github.event.repository.default_branch \}\}/g) || []).length,
    2,
  );
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
  assert.match(inferenceJob, /name: Remove action Git credentials\n        if: always\(\)/);
});

test('both Claude paths preserve the model and isolate execution configuration', () => {
  assert.equal(
    (inferenceJob.match(/inference-profile\/global.anthropic.claude-sonnet-5-5/g) || []).length,
    2,
  );
  for (const flag of [
    '--setting-sources user',
    '--strict-mcp-config',
    '--disable-slash-commands',
  ]) {
    assert.equal(inferenceJob.split(flag).length - 1, 2);
  }
  assert.equal((inferenceJob.match(/"disableAllHooks":true/g) || []).length, 2);
  const review = inferenceJob
    .split('      - name: Review pull request\n')[1]
    .split('      - name: Handle custom request\n')[0];
  assert.match(review, /--tools Bash/);
  assert.match(
    review,
    /--allowed-tools 'Bash\(gh pr diff:\*\),Bash\(gh pr view:\*\),Bash\(gh pr comment:\*\)'/,
  );
  assert.match(review, /\n          prompt: \|/);
  const custom = inferenceJob
    .split('      - name: Handle custom request\n')[1]
    .split('      - name: Remove action Git credentials\n')[0];
  assert.match(custom, /use_commit_signing: 'true'/);
  assert.match(custom, /--tools Read,Grep,Glob,Edit,Write/);
  assert.doesNotMatch(custom, /Bash|\n          prompt:/);
});
