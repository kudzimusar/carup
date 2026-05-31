import fs from 'fs';
import path from 'path';

// Agent 15: Missing System Discovery Agent
console.log('\n=============================================================');
console.log('AGENT 15: MISSING SYSTEM DISCOVERY AGENT');
console.log('=============================================================\n');
console.log('Analyzing Playwright test results and system outputs...\n');

const resultsPath = path.join(process.cwd(), 'test-results', 'agent-results.json');
if (!fs.existsSync(resultsPath)) {
  console.log('No test results found. Ensure you run the Playwright tests first.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

// We parse the stdout of the tests where our agents logged "Missing:" or "Crash:"
const missingSystems = [];
const crashes = [];

function traverseSuite(suite) {
  suite.specs?.forEach(spec => {
    spec.tests?.forEach(test => {
      test.results?.forEach(result => {
        result.stdout?.forEach(out => {
          const text = out.text || '';
          if (text.includes('Missing:')) {
            missingSystems.push({
              agent: suite.title,
              issue: text.trim().replace('Missing: ', '')
            });
          }
          if (text.includes('Crash:')) {
            crashes.push({
              agent: suite.title,
              issue: text.trim().replace('Crash: ', '')
            });
          }
        });
        
        // Also capture actual test failures (Playwright assertions)
        if (result.status === 'failed' || result.status === 'timedOut') {
          missingSystems.push({
            agent: suite.title,
            issue: `E2E Flow Failed: ${spec.title} - Check routes and buttons`
          });
        }
      });
    });
  });

  suite.suites?.forEach(child => traverseSuite(child));
}

data.suites?.forEach(suite => traverseSuite(suite));

console.log('PRIORITY MATRIX');
console.log('---------------\n');

console.log('[CRITICAL]');
crashes.forEach(c => console.log(`- ${c.agent}: ${c.issue}`));
missingSystems.filter(m => m.issue.toLowerCase().includes('failed') || m.issue.toLowerCase().includes('escrow') || m.issue.toLowerCase().includes('checkout')).forEach(m => console.log(`- ${m.agent}: ${m.issue}`));
if (crashes.length === 0) console.log('None detected.');

console.log('\n[HIGH]');
missingSystems.filter(m => !m.issue.toLowerCase().includes('failed') && (m.issue.toLowerCase().includes('api') || m.issue.toLowerCase().includes('upload') || m.issue.toLowerCase().includes('flow') || m.issue.toLowerCase().includes('table'))).forEach(m => console.log(`- ${m.agent}: ${m.issue}`));

console.log('\n[MEDIUM]');
missingSystems.filter(m => !m.issue.toLowerCase().includes('failed') && !m.issue.toLowerCase().includes('api') && !m.issue.toLowerCase().includes('upload') && !m.issue.toLowerCase().includes('flow') && !m.issue.toLowerCase().includes('table')).forEach(m => console.log(`- ${m.agent}: ${m.issue}`));

console.log('\n=============================================================');
console.log('FINAL QA SUCCESS CONDITION: FAILED');
console.log('The system is currently a prototype with missing backend flows.');
console.log('Refer to the Priority Matrix to begin production hardening.');
console.log('=============================================================\n');
