/**
 * contracts/invites_project_isolation.test.js — 邀請註冊 + 帳號/專案隔離（A1–A3、B6）
 *
 * 取代人工驗證：
 *   A1 管理員發邀請碼；A2 用邀請碼註冊並登入；A3 新帳號僅能看到被授權專案。
 *   B6 受限帳號列邊界時只看得到授權專案的邊界（projectAuthFilter）。
 *
 * 隔離以「存在但無權限 → 404」呈現（刻意偽裝，避免洩漏專案存在性）。
 * 全部資料 TEST_ID 前綴；反向清理。
 */
'use strict';

const assert = require('assert');
const { Api } = require('../helpers/apiClient');
const { TEST_ID } = require('../config');

function polygonAround(lat, lng, d = 0.001) {
  return [
    [lat - d, lng - d],
    [lat - d, lng + d],
    [lat + d, lng + d],
    [lat + d, lng - d],
  ];
}

module.exports = {
  section: 'contracts',
  cases: [
    {
      name: '邀請註冊 + 隔離：新帳號只能存取被授權專案（by_code 200/404），邊界列表亦受限',
      run: async (ctx) => {
        const { api, factories, assert: A, cleanup } = ctx;

        await api.login('admin');

        // 兩個專案：A 授權、B 不授權
        const areaA = factories.buildArea();
        const rAreaA = await api.post('project_areas', areaA);
        A.assertJsonOk(rAreaA, '建區位 A');
        cleanup.track('area', rAreaA.body.data.id);
        const pA = factories.buildProject({ area: areaA.area_name });
        const rPA = await api.post('projects/add', { name: pA.name, area: pA.area });
        A.assertJsonOk(rPA, '建專案 A');
        const codeA = rPA.body.project.code;
        cleanup.track('project', codeA);

        const areaB = factories.buildArea();
        const rAreaB = await api.post('project_areas', areaB);
        A.assertJsonOk(rAreaB, '建區位 B');
        cleanup.track('area', rAreaB.body.data.id);
        const pB = factories.buildProject({ area: areaB.area_name });
        const rPB = await api.post('projects/add', { name: pB.name, area: pB.area });
        A.assertJsonOk(rPB, '建專案 B');
        const codeB = rPB.body.project.code;
        cleanup.track('project', codeB);

        // 為兩專案各建邊界（B6 用）
        const rBndA = await api.post('project-boundaries', {
          projectName: pA.name,
          projectCode: codeA,
          projectArea: areaA.area_name,
          coordinates: polygonAround(23.86, 121.51),
        });
        A.assertJsonOk(rBndA, '建邊界 A');
        cleanup.track('custom', `bnd-${codeA}`, async (cApi) => {
          await cApi.delete(`project-boundaries/by_code/${encodeURIComponent(codeA)}`);
        });
        const rBndB = await api.post('project-boundaries', {
          projectName: pB.name,
          projectCode: codeB,
          projectArea: areaB.area_name,
          coordinates: polygonAround(23.90, 121.55),
        });
        A.assertJsonOk(rBndB, '建邊界 B');
        cleanup.track('custom', `bnd-${codeB}`, async (cApi) => {
          await cApi.delete(`project-boundaries/by_code/${encodeURIComponent(codeB)}`);
        });

        // A1：發邀請碼（僅授權專案 A）
        const rInvite = await api.post('invites', {
          role: '一般使用者',
          max_uses: 1,
          project_codes: [codeA],
        });
        A.assertJsonOk(rInvite, '建邀請碼');
        const inviteCode = rInvite.body.invite && rInvite.body.invite.code;
        const inviteId = rInvite.body.invite && rInvite.body.invite.invite_id;
        assert.ok(inviteCode, '應回傳 invite.code');
        if (inviteId != null) {
          cleanup.track('custom', `invite-${inviteId}`, async (cApi) => {
            await cApi.patch(`invites/${inviteId}/deactivate`, {});
          });
        }

        // A2：用邀請碼註冊（公開端點）
        const username = `iso_${TEST_ID}`;
        const password = 'TestPass123!';
        const rReg = await api.post('register', {
          invite_code: inviteCode,
          username,
          password,
          display_name: '隔離測試',
        });
        A.assertJsonOk(rReg, '註冊');
        const userId = rReg.body.userId;
        assert.ok(userId, '註冊應回 userId');
        cleanup.track('user', userId);

        // 若需審核則由 admin 啟用
        if (rReg.body.pending_approval) {
          const rAct = await api.put(`users/${userId}/status`, { isActive: true });
          A.assertJsonOk(rAct, '啟用帳號');
        }

        // 新帳號登入（一般使用者：不帶 loginType=admin）
        const userApi = new Api();
        const rLogin = await userApi.post('login', { account: username, password });
        A.assertJsonOk(rLogin, '新帳號登入');
        userApi.setToken(rLogin.body.token);

        // A3 隔離：授權專案 200、未授權專案 404
        const rSeeA = await userApi.get(`projects/by_code/${encodeURIComponent(codeA)}`);
        A.assertJsonOk(rSeeA, '新帳號可見授權專案 A');
        const rSeeB = await userApi.get(`projects/by_code/${encodeURIComponent(codeB)}`);
        A.assertStatus(rSeeB, 404, '新帳號不可見未授權專案 B（偽裝為 404）');

        // B6：邊界列表受 projectAuthFilter 限制 → 只含 A，不含 B
        const rList = await userApi.get('project-boundaries');
        A.assertJsonOk(rList, '新帳號列邊界');
        const listedCodes = (rList.body.data || []).map((r) => r.project_code);
        assert.ok(listedCodes.includes(codeA), `邊界列表應含授權專案 A（${codeA}）`);
        assert.ok(
          !listedCodes.includes(codeB),
          `邊界列表不應含未授權專案 B（${codeB}）：${JSON.stringify(listedCodes)}`,
        );
      },
    },
  ],
};
