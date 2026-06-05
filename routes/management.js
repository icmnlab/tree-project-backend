const express = require('express');
const router = express.Router();
const db = require('../config/db');
const treeManagementController = require('../controllers/treeManagementController');
const { requireRole } = require('../middleware/roleAuth');
const { projectAuth, projectAuthFilter } = require('../middleware/projectAuth');

// 樹木管理建議 API 路由
router.post('/actions/generate', requireRole('專案管理員'), projectAuthFilter, projectAuth, treeManagementController.generateManagementActions);
router.get('/actions', requireRole('調查管理員'), projectAuthFilter, treeManagementController.getManagementActions);
router.put('/actions/:action_id', requireRole('專案管理員'), projectAuthFilter, treeManagementController.updateManagementAction);
router.delete('/actions/:action_id', requireRole('專案管理員'), projectAuthFilter, treeManagementController.deleteManagementAction);

module.exports = router;
