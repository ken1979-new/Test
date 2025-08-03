import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// --- Helper: 動態載入外部腳本的 Hook ---
const useScript = (src) => {
    const [status, setStatus] = useState(src ? "loading" : "idle");
    useEffect(() => {
        if (!src) { setStatus("idle"); return; }
        let script = document.querySelector(`script[src="${src}"]`);
        if (!script) {
            script = document.createElement("script"); script.src = src; script.async = true; document.body.appendChild(script);
            const setAttributeFromEvent = (event) => { script.setAttribute("data-status", event.type === "load" ? "ready" : "error"); };
            script.addEventListener("load", setAttributeFromEvent); script.addEventListener("error", setAttributeFromEvent);
        } else { setStatus(script.getAttribute("data-status") || "loading"); }
        const setStateFromEvent = (event) => { setStatus(event.type === "load" ? "ready" : "error"); };
        script.addEventListener("load", setStateFromEvent); script.addEventListener("error", setStateFromEvent);
        return () => { if (script) { script.removeEventListener("load", setStateFromEvent); script.removeEventListener("error", setStateFromEvent); } };
    }, [src]);
    return status;
};

// --- Helper Functions & Configuration ---
const sanitizeKey = (key) => key ? key.replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, ' ').trim() : '';
const FIELD_DEFINITIONS = {
    tms: {
        testId: { displayName: '測項編號 (Test ID)', aliases: ['TestCase ID', 'Test Case ID', 'TestCaseID'], required: true },
        topic: { displayName: 'Topic', aliases: ['Topic', 'topic'], required: true },
        manualIssueGrade: { displayName: '客訴等級', aliases: ['Manual Issue Grade'], optional: true },
        sanityManual: { displayName: 'Sanity 標籤', aliases: ['Sanity(Manual)'], optional: true },
        manualTimeSpent: { displayName: '花費時間', aliases: ['Manual Time Spent'], optional: true }
    },
    sbm: {
        testId: { displayName: '關聯測項 (TCs Applied)', aliases: ['TCs Applied'], required: true },
        gating: { displayName: 'Gating 屬性', aliases: ['Gating Requirement', 'GatingRequirement'], required: true },
        state: { displayName: '狀態 (State)', aliases: ['State', 'state'], required: true },
        bugAttribute: { displayName: 'Bug 屬性', aliases: ['BugAttribute', 'Bug Attribute'], optional: true },
        issueA: { displayName: 'B公司映射A公司 Issue(一)', aliases: ['YiDao_mapping_ASUS_Issue_A'], optional: true },
    },
    sbmB: {
        testId: { displayName: '關聯測項 (TCs Applied)', aliases: ['TCs Applied'], required: true },
        gating: { displayName: 'Gating 屬性', aliases: ['Gating Requirement', 'GatingRequirement'], required: true },
        state: { displayName: '狀態 (State)', aliases: ['State', 'state'], required: true },
        issueB: { displayName: 'B公司映射A公司 Issue(二)', aliases: ['YiDao_mapping_ASUS_Issue_B'], optional: true },
    },
    topic: {
        testId: { displayName: '測項編號 (Test ID)', aliases: ['分類下所屬測項編號'], required: true },
        testGroup: { displayName: '測試群組', aliases: ['分類名稱', 'Test Group'], required: true }
    }
};
const downloadData = (data, filename, type) => {
    if (typeof window === 'undefined') return;
    if (!data || data.length === 0) { console.error('沒有可下載的資料。'); return; }
    let blob;
    if (type === 'txt') {
        blob = new Blob([data.join(',')], { type: 'text/plain;charset=utf-8,' });
    } else if (type === 'csv') {
        if (typeof window.Papa === 'undefined') { console.error('PapaParse library is not available.'); alert('CSV 處理函式庫尚未載入，請稍後再試。'); return; }
        const csv = window.Papa.unparse(data);
        blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8,' });
    }
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// --- Reusable UI Components ---
const Card = ({ title, children, className }) => ( <div className={`bg-white rounded-xl shadow-md p-6 mb-6 ${className}`}> {title && <h2 className="text-xl font-bold text-gray-700 mb-4 border-b pb-2">{title}</h2>} {children} </div> );
const Modal = ({ show, onClose, title, children, maxWidth = 'max-w-md' }) => {
    if (!show) return null;
    return ( <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50" onClick={onClose}> <div className={`relative mx-auto p-5 border w-full ${maxWidth} shadow-lg rounded-md bg-white`} onClick={e => e.stopPropagation()}> <div className="mt-3 text-center"><h3 className="text-lg leading-6 font-medium text-gray-900">{title}</h3><div className="mt-2 px-7 py-3 text-left text-sm text-gray-600">{children}</div><div className="items-center px-4 py-3"><button onClick={onClose} className="px-4 py-2 bg-blue-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300">關閉</button></div></div> </div> </div> );
};
const FileUploader = ({ id, label, description, onFileSelect, status, icon, multiple = false, disabled = false }) => ( <div className="border border-gray-200 rounded-lg p-4 flex flex-col items-center text-center h-full"> {icon} <h3 className="font-semibold text-gray-700">{label}</h3> <p className="text-sm text-gray-500 mb-4 flex-grow">{description}</p> <input type="file" id={id} className="hidden" accept=".csv,.xlsx" onChange={onFileSelect} multiple={multiple} onClick={(e) => e.target.value = null} disabled={disabled} /> <button onClick={() => document.getElementById(id).click()} className="w-full py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed" disabled={disabled}>選擇檔案</button> <p className={`text-sm mt-2 font-semibold truncate w-full ${status.isError ? 'text-red-500' : 'text-green-600'}`} title={status.message}> {status.isLoading && <span className="loader inline-block align-middle mr-2"></span>} {status.message || '尚未選擇'} </p> </div> );

const CustomMultiSelect = ({ name, options, onSelectionChange, disabled }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selected, setSelected] = useState(new Set(['all']));
    const ref = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => { if (ref.current && !ref.current.contains(event.target)) setIsOpen(false); };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [ref]);

    const handleSelection = (option) => {
        const newSelected = new Set(selected);
        if (option === 'all') {
            newSelected.clear();
            newSelected.add('all');
        } else {
            newSelected.delete('all');
            if (newSelected.has(option)) {
                newSelected.delete(option);
            } else {
                newSelected.add(option);
            }
            if (newSelected.size === 0) {
                newSelected.add('all');
            }
        }
        setSelected(newSelected);
        onSelectionChange(Array.from(newSelected));
    };

    const getButtonText = () => {
        if (selected.has('all') || selected.size === 0) return '全部';
        if (selected.size > 2) return `已選擇 ${selected.size} 個`;
        return Array.from(selected).join(', ');
    };

    return (
        <div className="relative" ref={ref}>
            <button onClick={() => setIsOpen(!isOpen)} className="w-full bg-white border border-gray-300 rounded-md shadow-sm pl-3 pr-10 py-2 text-left focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed" disabled={disabled}>
                <span className="block truncate">{getButtonText()}</span>
                <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none"><svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 01.707.293l3 3a1 1 0 01-1.414 1.414L10 5.414 7.707 7.707a1 1 0 01-1.414-1.414l3-3A1 1 0 0110 3zm-3.707 9.293a1 1 0 011.414 0L10 14.586l2.293-2.293a1 1 0 011.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg></span>
            </button>
            {isOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
                    <label className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">
                        <input type="checkbox" className="mr-2" checked={selected.has('all')} onChange={() => handleSelection('all')} /> 全部
                    </label>
                    {options.map(option => (
                        <label key={option} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">
                            <input type="checkbox" className="mr-2" checked={selected.has(option)} onChange={() => handleSelection(option)} /> {option}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};


// --- Feature Components ---
const FieldMappingModal = ({ show, onClose, onConfirm, modalState }) => {
    const [mappings, setMappings] = useState({});
    useEffect(() => {
        if (modalState.validationResults) {
            const initialMappings = {};
            for (const key in modalState.validationResults) {
                initialMappings[key] = modalState.validationResults[key].mappedTo || "";
            }
            setMappings(initialMappings);
        }
    }, [modalState.validationResults]);

    if (!show || !modalState.validationResults) return null;

    const handleConfirm = () => {
        const finalMapping = {};
        let allRequiredMapped = true;
        for (const key in modalState.validationResults) {
            const currentVal = mappings[key] || modalState.validationResults[key].mappedTo;
            finalMapping[key] = currentVal === "__NONE__" ? null : currentVal;
            if (FIELD_DEFINITIONS[modalState.fileType][key].required && !finalMapping[key]) {
                allRequiredMapped = false;
            }
        }
        if (!allRequiredMapped) { alert('請為所有必要欄位 (*) 選擇對應的項目。'); return; }
        onConfirm(finalMapping);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl">
                <h2 className="text-xl font-bold text-gray-800 mb-4">欄位對應確認: {modalState.fileName}</h2>
                <div className="space-y-4 max-h-96 overflow-y-auto p-2">
                    {Object.entries(modalState.validationResults).map(([key, result]) => (
                        <div key={key} className="grid grid-cols-3 gap-4 items-center">
                            <label className="font-semibold text-sm text-left">{result.displayName} {FIELD_DEFINITIONS[modalState.fileType][key].required && <span className="text-red-500">*</span>}</label>
                            <span className={`text-sm ${result.found ? 'text-green-600' : 'text-red-600'}`}>{result.found ? '✓ 自動找到' : '✗ 未找到'}</span>
                            <select className="form-select w-full border-gray-300 rounded-md text-sm" value={mappings[key] || ""} onChange={(e) => setMappings(prev => ({ ...prev, [key]: e.target.value }))}>
                                <option value="">請選擇對應欄位...</option>
                                {!FIELD_DEFINITIONS[modalState.fileType][key].required && <option value="__NONE__">無對應</option>}
                                {modalState.headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </div>
                    ))}
                </div>
                <div className="mt-6 flex justify-end space-x-4">
                    <button onClick={onClose} className="py-2 px-4 bg-gray-500 text-white rounded-md hover:bg-gray-600">取消</button>
                    <button onClick={handleConfirm} className="py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700">確認並繼續</button>
                </div>
            </div>
        </div>
    );
};

const WeightSettings = ({ weights, onWeightChange }) => {
    const handleChange = (e) => {
        const { id, value } = e.target;
        onWeightChange({ ...weights, [id]: parseFloat(value) || 0 });
    };
    return (
        <>
            <h3 className="text-lg font-semibold text-gray-800">風險因子權重</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                <div><label htmlFor="gating" className="block text-sm font-medium text-gray-700 mb-1">Gating Bugs 權重</label><input type="number" id="gating" className="w-full border-gray-300 rounded-md shadow-sm" value={weights.gating} onChange={handleChange} step="0.1" /></div>
                <div><label htmlFor="critical" className="block text-sm font-medium text-gray-700 mb-1">Closed Critical Bugs 權重</label><input type="number" id="critical" className="w-full border-gray-300 rounded-md shadow-sm" value={weights.critical} onChange={handleChange} /></div>
                <div><label htmlFor="complaint" className="block text-sm font-medium text-gray-700 mb-1">客訴分數</label><input type="number" id="complaint" className="w-full border-gray-300 rounded-md shadow-sm" value={weights.complaint} onChange={handleChange} /></div>
                <div><label htmlFor="sanity" className="block text-sm font-medium text-gray-700 mb-1">Sanity 分數</label><input type="number" id="sanity" className="w-full border-gray-300 rounded-md shadow-sm" value={weights.sanity} onChange={handleChange} /></div>
            </div>
            <h3 className="text-lg font-semibold text-gray-800 pt-4 mt-4">相關係數</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                 <div><label htmlFor="coeffAp" className="block text-sm font-medium text-gray-700 mb-1">相關係數 (僅 AP)</label><input type="number" id="coeffAp" className="w-full border-gray-300 rounded-md shadow-sm" value={weights.coeffAp} onChange={handleChange} step="0.1" /></div>
                 <div><label htmlFor="coeffOther" className="block text-sm font-medium text-gray-700 mb-1">相關係數 (其餘)</label><input type="number" id="coeffOther" className="w-full border-gray-300 rounded-md shadow-sm" value={weights.coeffOther} onChange={handleChange} step="0.1" /></div>
            </div>
            <div className="mt-6 pt-4 border-t border-gray-200">
                <h3 className="text-md font-semibold text-gray-700 mb-2">風險分數計算公式</h3>
                <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg"><code>風險分數 = (Gating Bugs * Gating權重 + Closed Critical * Critical權重) * 相關係數 + 客訴分數 + Sanity分數</code></p>
            </div>
        </>
    );
};

const PriorityTable = ({ data, onSort, sortConfig, selectedIds, onSelect, onSelectAll, showCompanyB }) => {
    const SortableHeader = ({ sortKey, children }) => (
        <th className="p-3 text-left cursor-pointer whitespace-nowrap" onClick={() => onSort(sortKey)}>
            {children}
            {sortConfig.key === sortKey && (sortConfig.direction === 'asc' ? ' ▲' : ' ▼')}
        </th>
    );
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-100 z-10">
                    <tr>
                        <th className="p-3"><input type="checkbox" onChange={onSelectAll} checked={data.length > 0 && selectedIds.size === data.length} /></th>
                        <th className="p-3 text-left whitespace-nowrap">測試群組</th>
                        <SortableHeader sortKey="testId">Test ID</SortableHeader>
                        <SortableHeader sortKey="gatingBugsCount">Gating Bugs</SortableHeader>
                        <SortableHeader sortKey="closedCriticalCount">Closed Critical</SortableHeader>
                        {showCompanyB && <SortableHeader sortKey="gatingBugsCountB">B公司 Gating</SortableHeader>}
                        {showCompanyB && <SortableHeader sortKey="closedCriticalCountB">B公司 Closed</SortableHeader>}
                        <SortableHeader sortKey="manualIssueGrade">客訴</SortableHeader>
                        <SortableHeader sortKey="sanityManual">SANITY</SortableHeader>
                        <th className="p-3 text-left whitespace-nowrap">BugAttr</th>
                        <SortableHeader sortKey="manualTimeSpent">花費時間(分)</SortableHeader>
                        <SortableHeader sortKey="riskScore">風險分數</SortableHeader>
                    </tr>
                </thead>
                <tbody>
                    {data.length > 0 ? data.map(item => (
                        <tr key={item.testId} className="border-b hover:bg-gray-50">
                            <td className="p-3"><input type="checkbox" checked={selectedIds.has(item.testId)} onChange={() => onSelect(item.testId)} /></td>
                            <td className="p-3">{item.testGroup}</td>
                            <td className="p-3">{item.testId}</td>
                            <td className="p-3 text-center">{item.gatingBugsCount}</td>
                            <td className="p-3 text-center">{item.closedCriticalCount}</td>
                            {showCompanyB && <td className="p-3 text-center">{item.gatingBugsCountB}</td>}
                            {showCompanyB && <td className="p-3 text-center">{item.closedCriticalCountB}</td>}
                            <td className="p-3">{item.manualIssueGrade === 'Gating_CSC' ? <span className="px-2 py-1 text-xs font-semibold text-red-800 bg-red-100 rounded-full">Gating_CSC</span> : '無'}</td>
                            <td className="p-3">{item.sanityManual === 'Y' ? <span className="px-2 py-1 text-xs font-semibold text-blue-800 bg-blue-100 rounded-full">Y</span> : 'N'}</td>
                            <td className="p-3">{item.bugAttributes}</td>
                            <td className="p-3 text-center">{item.manualTimeSpent}</td>
                            <td className={`p-3 font-bold text-lg text-center ${item.riskScore > 50 ? 'text-red-600' : (item.riskScore > 20 ? 'text-yellow-600' : 'text-gray-700')}`}>{item.riskScore.toFixed(1)}</td>
                        </tr>
                    )) : (
                        <tr><td colSpan={showCompanyB ? 12 : 10} className="text-center py-10 text-gray-500">沒有資料可顯示。請檢查您的篩選條件。</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

const StrategicPlan = ({ currentTableData, sbmData, fieldMappings, currentTopic, tmsData }) => {
    const [totalPlanCount, setTotalPlanCount] = useState(22);
    const [basis, setBasis] = useState('gating_total');

    const planData = useMemo(() => {
        if (!currentTableData || currentTableData.length === 0 || !sbmData.length || !fieldMappings.sbm || !currentTopic) return { percentages: [], suggestions: [] };

        const allTopicTestIds = new Set(tmsData.filter(t => t[fieldMappings.tms.topic] === currentTopic).map(t => String(t[fieldMappings.tms.testId])));
        const testGroups = currentTableData.reduce((acc, item) => {
            if (item.testGroup) {
                if (!acc[item.testGroup]) acc[item.testGroup] = new Set();
                acc[item.testGroup].add(String(item.testId));
            }
            return acc;
        }, {});

        const weightFilter = (bug) => {
            const req = bug[fieldMappings.sbm.gating];
            const state = bug[fieldMappings.sbm.state];
            switch (basis) {
                case 'gating_total': return req === 'Gating';
                case 'gating_close': return req === 'Gating' && state === 'Closed - Child';
                case 'critical_total': return ['Gating', 'Gating Candidate'].includes(req);
                case 'critical_close': return ['Gating', 'Gating Candidate'].includes(req) && state === 'Closed - Child';
                default: return false;
            }
        };

        const topicBugs = sbmData.filter(bug => {
            const appliedTcs = bug[fieldMappings.sbm.testId];
            return appliedTcs && String(appliedTcs).split(',').map(s => s.trim()).some(id => allTopicTestIds.has(id));
        });

        let groupStats = Object.entries(testGroups).map(([groupName, testIdSet]) => {
            const bugCount = topicBugs.filter(bug => {
                const appliedTcs = bug[fieldMappings.sbm.testId];
                return appliedTcs && String(appliedTcs).split(',').map(s => s.trim()).some(id => testIdSet.has(id)) && weightFilter(bug);
            }).length;
            return { groupName, bugCount };
        });

        const totalBugs = groupStats.reduce((sum, stat) => sum + stat.bugCount, 0);
        groupStats.forEach(stat => {
            stat.percentage = totalBugs > 0 ? (stat.bugCount / totalBugs) * 100 : (groupStats.length > 0 ? 100 / groupStats.length : 0);
        });

        const distributed = groupStats.map(stat => ({
            ...stat,
            exact: totalPlanCount * (stat.percentage / 100),
            rounded: Math.floor(totalPlanCount * (stat.percentage / 100))
        }));
        
        let remainder = totalPlanCount - distributed.reduce((sum, item) => sum + item.rounded, 0);
        distributed.sort((a, b) => (b.exact - b.rounded) - (a.exact - a.rounded));
        for (let i = 0; i < remainder; i++) {
            if (distributed[i]) distributed[i].rounded++;
        }
        
        distributed.sort((a, b) => a.groupName.localeCompare(b.groupName));

        return { percentages: groupStats.sort((a, b) => b.percentage - a.percentage), suggestions: distributed };
    }, [currentTableData, sbmData, fieldMappings, totalPlanCount, basis, currentTopic, tmsData]);

    return (
        <Card title="4. 策略性抽測計畫生成">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                <div>
                    <label htmlFor="total-plan-count" className="block text-sm font-medium text-gray-700 mb-1">計畫總抽測數量：</label>
                    <input type="number" id="total-plan-count" className="form-input w-48 border-gray-300 rounded-md" value={totalPlanCount} onChange={e => setTotalPlanCount(parseInt(e.target.value) || 0)} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">權重計算依據：</label>
                    <div className="flex flex-wrap gap-2">
                        {[{key: 'gating_total', label: 'Gating - Total'}, {key: 'gating_close', label: 'Gating - Close'}, {key: 'critical_total', label: 'Critical - Total'}, {key: 'critical_close', label: 'Critical - Close'}].map(b => (
                            <button key={b.key} onClick={() => setBasis(b.key)} className={`py-1 px-3 text-sm rounded-md border ${basis === b.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>{b.label}</button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                    <h3 className="font-semibold text-gray-700 mb-4">各群組 Bug 佔比 (%)</h3>
                    <div className="space-y-4">
                        {planData.percentages.map(stat => (
                            <div key={stat.groupName} className="grid grid-cols-4 items-center gap-2 text-sm">
                                <span className="col-span-1 truncate font-medium">{stat.groupName}</span>
                                <div className="col-span-3 bg-gray-200 rounded-full h-6">
                                    <div className="bg-blue-500 h-6 rounded-full text-white text-xs flex items-center justify-center" style={{width: `${stat.percentage.toFixed(1)}%`}}>{stat.percentage.toFixed(1)}%</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <h3 className="font-semibold text-gray-700 mb-4">抽測數量分配建議</h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                        <table className="w-full text-sm">
                            <thead><tr className="bg-gray-200"><th className="p-2 text-left">群組</th><th className="p-2 text-center">佔比</th><th className="p-2 text-center">抽測數</th></tr></thead>
                            <tbody>
                                {planData.suggestions.map(stat => (
                                    <tr key={stat.groupName} className="border-b">
                                        <td className="p-2 font-medium">{stat.groupName}</td>
                                        <td className="p-2 text-center">{stat.percentage.toFixed(1)}%</td>
                                        <td className="p-2 text-center font-bold text-blue-600">{stat.rounded}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot><tr className="bg-gray-200 font-bold"><td className="p-2">總計</td><td className="p-2 text-center">{planData.suggestions.reduce((s, i) => s + i.percentage, 0).toFixed(1)}%</td><td className="p-2 text-center">{totalPlanCount}</td></tr></tfoot>
                        </table>
                    </div>
                </div>
            </div>
        </Card>
    );
};

const TopicAnalysisView = ({ tmsData, sbmData, fieldMappings, isVisible, allFilesLoaded }) => {
    const [selectedTopics, setSelectedTopics] = useState(['all']);
    const [selectedGatings, setSelectedGatings] = useState(['all']);
    const [selectedStates, setSelectedStates] = useState(['all']);
    const [showChart, setShowChart] = useState(false);
    const [chartType, setChartType] = useState('pie');
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [totalPlanCount, setTotalPlanCount] = useState(20);
    const [analysisResult, setAnalysisResult] = useState([]);

    const chartRef = useRef(null);
    const chartInstanceRef = useRef(null);

    const filterOptions = useMemo(() => {
        if (!allFilesLoaded) return { topics: [], gatings: [], states: [] };
        const topics = [...new Set(tmsData.map(item => item[fieldMappings.tms.topic]).filter(Boolean))].sort();
        const gatings = [...new Set(sbmData.map(item => item[fieldMappings.sbm.gating]).filter(Boolean))].sort();
        const states = [...new Set(sbmData.map(item => item[fieldMappings.sbm.state]).filter(Boolean))].sort();
        return { topics, gatings, states };
    }, [allFilesLoaded, tmsData, sbmData, fieldMappings]);

    const runAnalysis = useCallback(() => {
        if (!allFilesLoaded) return;
        
        const topicMap = tmsData.reduce((acc, testCase) => {
            const topic = testCase[fieldMappings.tms.topic];
            const testId = testCase[fieldMappings.tms.testId];
            if (topic && testId) {
                if (!acc[topic]) acc[topic] = new Set();
                acc[topic].add(String(testId));
            }
            return acc;
        }, {});

        const filteredBugs = sbmData.filter(bug =>
            (selectedGatings.includes('all') || (fieldMappings.sbm.gating && selectedGatings.includes(bug[fieldMappings.sbm.gating]))) &&
            (selectedStates.includes('all') || (fieldMappings.sbm.state && selectedStates.includes(bug[fieldMappings.sbm.state]))) &&
            (fieldMappings.sbm.testId && bug[fieldMappings.sbm.testId])
        );

        let results = Object.entries(topicMap)
            .filter(([topicName, _]) => selectedTopics.includes('all') || selectedTopics.includes(topicName))
            .map(([topicName, testCaseIds]) => ({
                topicName,
                testCaseCount: testCaseIds.size,
                issueCount: filteredBugs.filter(bug => {
                    const appliedTcs = bug[fieldMappings.sbm.testId];
                    return (typeof appliedTcs === 'string' || typeof appliedTcs === 'number') && String(appliedTcs).split(',').map(s => s.trim()).some(id => testCaseIds.has(id));
                }).length
            }));

        const totalIssues = results.reduce((sum, result) => sum + result.issueCount, 0);
        results.forEach(result => {
            result.issuePercentage = totalIssues > 0 ? (result.issueCount / totalIssues) * 100 : 0;
            result.suggestedCount = Math.round(totalPlanCount * (result.issuePercentage / 100));
        });

        results.sort((a, b) => b.issuePercentage - a.issuePercentage);
        setAnalysisResult(results);

    }, [allFilesLoaded, tmsData, sbmData, fieldMappings, selectedTopics, selectedGatings, selectedStates, totalPlanCount]);

    useEffect(() => {
        if (isVisible && allFilesLoaded) {
            runAnalysis();
        }
    }, [isVisible, allFilesLoaded, runAnalysis]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.Chart) return;
        if (chartInstanceRef.current) chartInstanceRef.current.destroy();
        if (!chartRef.current || !analysisResult.length || !showChart) return;

        const top10Data = analysisResult.filter(d => d.issuePercentage > 0).slice(0, 10);
        const labels = top10Data.map(d => d.topicName);
        const data = top10Data.map(d => d.issuePercentage);
        
        const ctx = chartRef.current.getContext('2d');
        const colors = labels.map((_, i) => `hsl(${(i * 360 / labels.length) % 360}, 70%, 60%)`);

        let chartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: chartType === 'pie', position: 'top' }, tooltip: { callbacks: { label: (context) => `${context.label}: ${context.parsed.toFixed(2)}%` } } }, scales: {} };
        let finalChartType = chartType;
        if (chartType === 'bar' || chartType === 'horizontalBar') {
            finalChartType = 'bar';
            if (chartType === 'horizontalBar') {
                chartOptions.indexAxis = 'y';
                chartOptions.scales = { x: { beginAtZero: true, ticks: { callback: (v) => v + '%' } } };
            } else {
                chartOptions.scales = { y: { beginAtZero: true, ticks: { callback: (v) => v + '%' } } };
            }
        }

        chartInstanceRef.current = new window.Chart(ctx, {
            type: finalChartType,
            data: { labels, datasets: [{ label: 'Issue 佔比 (%)', data, backgroundColor: colors }] },
            options: chartOptions
        });

        return () => { if (chartInstanceRef.current) chartInstanceRef.current.destroy(); };
    }, [analysisResult, chartType, showChart]);

    if (!isVisible) return null;

    const handleChartButtonClick = (type) => {
        setChartType(type);
        setShowChart(true);
    }

    return (
        <>
            <Modal show={showHelpModal} onClose={() => setShowHelpModal(false)} title="欄位說明">
                <ul className="space-y-2 list-disc list-inside">
                    <li><b>Topic:</b> 測試案例所屬的主題分類。</li>
                    <li><b>測項數量:</b> 該 Topic 在 `TMSTestcase.csv` 中的總測項數。</li>
                    <li><b>Issue 數量:</b> 符合篩選條件且屬於該 Topic 的 Bug 總數。</li>
                    <li><b>Issue 佔比 (%):</b> `(單一 Topic 的 Issue 數 / 所有符合篩選條件 Topic 的 Issue 總數) * 100`</li>
                    <li><b>建議挑測數:</b> `總挑測條數 * Issue 佔比`，結果四捨五入。</li>
                </ul>
            </Modal>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 space-y-8">
                    <Card title="篩選條件">
                        <div className="space-y-4">
                            <div><label className="block text-sm font-medium text-gray-700 mb-1">Topic</label><CustomMultiSelect name="topic" options={filterOptions.topics} onSelectionChange={setSelectedTopics} disabled={!allFilesLoaded} /></div>
                            <div><label className="block text-sm font-medium text-gray-700 mb-1">Gating Requirement</label><CustomMultiSelect name="gating" options={filterOptions.gatings} onSelectionChange={setSelectedGatings} disabled={!allFilesLoaded} /></div>
                            <div><label className="block text-sm font-medium text-gray-700 mb-1">State</label><CustomMultiSelect name="state" options={filterOptions.states} onSelectionChange={setSelectedStates} disabled={!allFilesLoaded} /></div>
                            <div><label className="block text-sm font-medium text-gray-700 mb-1">總挑測條數</label><input type="number" className="form-input w-full border-gray-300 rounded-md" value={totalPlanCount} onChange={e => setTotalPlanCount(parseInt(e.target.value) || 0)} /></div>
                        </div>
                    </Card>
                    <Card title="視覺化圖表">
                        <div className="flex flex-wrap gap-2 mb-4">
                            <button onClick={() => handleChartButtonClick('pie')} className="py-2 px-4 text-sm bg-blue-500 text-white rounded-md" disabled={!analysisResult.length}>圓餅圖</button>
                            <button onClick={() => handleChartButtonClick('bar')} className="py-2 px-4 text-sm bg-blue-500 text-white rounded-md" disabled={!analysisResult.length}>長條圖</button>
                            <button onClick={() => handleChartButtonClick('horizontalBar')} className="py-2 px-4 text-sm bg-blue-500 text-white rounded-md" disabled={!analysisResult.length}>橫條圖</button>
                            {showChart && <button onClick={() => setShowChart(false)} className="py-2 px-4 text-sm bg-gray-500 text-white rounded-md">隱藏圖表</button>}
                        </div>
                        {showChart && <div className="relative h-80"><canvas ref={chartRef}></canvas></div>}
                    </Card>
                </div>
                <div className="lg:col-span-2 card">
                    <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold text-gray-700">Topic Issue 佔比分析結果</h2><button onClick={() => setShowHelpModal(true)} className="py-2 px-4 text-sm bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200">欄位說明</button></div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="bg-gray-100"><th className="p-2 text-left">Topic</th><th className="p-2 text-center">測項數量</th><th className="p-2 text-center">Issue 數量</th><th className="p-2 text-center">Issue 佔比</th><th className="p-2 text-center">建議挑測數</th></tr></thead>
                            <tbody>
                                {analysisResult.length > 0 ? analysisResult.map(item => (
                                    <tr key={item.topicName} className="border-b">
                                        <td className="p-2 font-medium">{item.topicName}</td>
                                        <td className="p-2 text-center">{item.testCaseCount}</td>
                                        <td className="p-2 text-center">{item.issueCount}</td>
                                        <td className="p-2 text-center">{item.issuePercentage.toFixed(2)}%</td>
                                        <td className="p-2 text-center font-bold text-blue-600">{item.suggestedCount}</td>
                                    </tr>
                                )) : (
                                    <tr><td colSpan="5" className="text-center py-10 text-gray-500">{!allFilesLoaded ? "請先在主頁面上傳檔案以啟用此功能。" : "在此篩選條件下沒有數據。"}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </>
    );
};


// --- Main Application Component ---
function App() {
    // --- Hooks and State ---
    const papaParseStatus = useScript("https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js");
    const xlsxStatus = useScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const chartJsStatus = useScript("https://cdn.jsdelivr.net/npm/chart.js");
    const librariesLoaded = papaParseStatus === 'ready' && xlsxStatus === 'ready' && chartJsStatus === 'ready';

    const [view, setView] = useState('priority');
    const [tmsData, setTmsData] = useState([]);
    const [sbmData, setSbmData] = useState([]);
    const [sbmDataB, setSbmDataB] = useState([]);
    const [testIdToGroupMap, setTestIdToGroupMap] = useState(new Map());
    const [fileStatus, setFileStatus] = useState({ tms: {}, sbm: {}, sbmB: {}, topic: {} });
    const [fieldMappings, setFieldMappings] = useState({});
    const [currentTopic, setCurrentTopic] = useState('');
    const [currentTestGroup, setCurrentTestGroup] = useState('all');
    const [weights, setWeights] = useState({ gating: 2, critical: 1, complaint: 50, sanity: 40, coeffAp: 1, coeffOther: 1.2 });
    const [isRealRisk, setIsRealRisk] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'riskScore', direction: 'desc' });
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [modalState, setModalState] = useState({ show: false, fileType: '', fileName: '', headers: [], validationResults: null, jsonData: null });
    
    // --- File Parsing and Processing ---
    const parseFile = useCallback((file) => {
        return new Promise((resolve, reject) => {
            if (!librariesLoaded) { return reject(new Error("函式庫尚未載入完成。")); }
            const reader = new FileReader();
            const ext = file.name.split('.').pop().toLowerCase();
            reader.onload = (e) => {
                try {
                    const data = e.target.result;
                    if (ext === 'xlsx') {
                        const workbook = window.XLSX.read(data, { type: 'array' });
                        const sheetName = workbook.SheetNames[0];
                        resolve(window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]));
                    } else if (ext === 'csv') {
                        window.Papa.parse(data, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data), error: reject });
                    } else { reject(new Error('不支援的檔案格式')); }
                } catch (error) { reject(error); }
            };
            reader.onerror = reject;
            if (ext === 'xlsx') reader.readAsArrayBuffer(file); else reader.readAsText(file);
        });
    }, [librariesLoaded]);

    const handleDataProcessing = useCallback((fileType, data, mapping, fileName) => {
        setFieldMappings(prev => ({ ...prev, [fileType]: mapping }));
        if (fileType === 'tms') setTmsData(data);
        else if (fileType === 'sbm') setSbmData(data);
        else if (fileType === 'sbmB') setSbmDataB(data);
        else if (fileType === 'topic') {
            const newMap = new Map();
            data.forEach(row => {
                const testId = String(row[mapping.testId]);
                const testGroup = row[mapping.testGroup];
                if (testId && testGroup) newMap.set(testId, testGroup);
            });
            setTestIdToGroupMap(newMap);
            fileName = `已載入 ${newMap.size} 筆對應`;
        }
        setFileStatus(prev => ({ ...prev, [fileType]: { message: fileName, isLoading: false, isError: false } }));
    }, []);

    const processAndSetFiles = useCallback(async (files, fileType, isMultiple = false) => {
        setFileStatus(prev => ({ ...prev, [fileType]: { message: `處理中...`, isLoading: true, isError: false } }));
        try {
            let allJsonData = [];
            for (const file of Array.from(files)) {
                const jsonData = await parseFile(file);
                allJsonData.push(...jsonData.map(row => Object.entries(row).reduce((acc, [key, val]) => ({ ...acc, [sanitizeKey(key)]: val }), {})));
            }
            const definitions = FIELD_DEFINITIONS[fileType];
            const headers = allJsonData.length > 0 ? Object.keys(allJsonData[0]) : [];
            const validationResults = {};
            let anyFieldMissing = false;

            for (const internalKey in definitions) {
                const { displayName, aliases } = definitions[internalKey];
                const foundHeader = headers.find(header => aliases.includes(header.trim()));
                
                validationResults[internalKey] = {
                    displayName,
                    found: !!foundHeader,
                    mappedTo: foundHeader || null
                };

                if (!foundHeader) {
                    anyFieldMissing = true;
                }
            }

            if (!anyFieldMissing) {
                const mapping = {};
                for (const key in validationResults) {
                    mapping[key] = validationResults[key].mappedTo;
                }
                handleDataProcessing(fileType, allJsonData, mapping, isMultiple ? `${files.length} 個檔案` : files[0].name);
            } else {
                setModalState({ show: true, fileType, fileName: isMultiple ? `${files.length} 個檔案` : files[0].name, headers, validationResults, jsonData: allJsonData });
            }
        } catch (error) {
            setFileStatus(prev => ({ ...prev, [fileType]: { message: error.message || '檔案處理失敗', isLoading: false, isError: true } }));
        }
    }, [parseFile, handleDataProcessing]);


    const handleModalConfirm = (confirmedMapping) => {
        const { fileType, jsonData, fileName } = modalState;
        handleDataProcessing(fileType, jsonData, confirmedMapping, fileName);
        setModalState({ show: false, fileType: '', fileName: '', headers: [], validationResults: null, jsonData: null });
    };
    
    const handleModalClose = () => {
        const { fileType } = modalState;
        setFileStatus(prev => ({ ...prev, [fileType]: { message: '已取消', isLoading: false, isError: true } }));
        setModalState({ show: false, fileType: '', fileName: '', headers: [], validationResults: null, jsonData: null });
    }

    // --- Data Calculation and Derivation ---
    const topicData = useMemo(() => {
        if (tmsData.length > 0 && testIdToGroupMap.size > 0 && fieldMappings.tms) {
            return tmsData.reduce((acc, tmsRow) => {
                const topicName = tmsRow[fieldMappings.tms.topic];
                const testId = String(tmsRow[fieldMappings.tms.testId]);
                const testGroup = testIdToGroupMap.get(testId);
                if (topicName && testGroup) {
                    if (!acc[topicName]) acc[topicName] = [];
                    acc[topicName].push({ testId, testGroup });
                }
                return acc;
            }, {});
        }
        return {};
    }, [tmsData, testIdToGroupMap, fieldMappings.tms]);

    useEffect(() => {
        if (!currentTopic && Object.keys(topicData).length > 0) {
            setCurrentTopic(Object.keys(topicData).sort()[0]);
        }
    }, [topicData, currentTopic]);


    const calculatedMasterData = useMemo(() => {
        console.log("[LOG] Recalculating master data due to dependencies change.");
        if (!currentTopic || !topicData[currentTopic] || sbmData.length === 0 || !fieldMappings.tms || !fieldMappings.sbm) return [];
        
        const topicTmsData = tmsData.filter(t => t[fieldMappings.tms.topic] === currentTopic);
        
        const bugsByTestId = sbmData.reduce((acc, bug) => { const tcIds = String(bug[fieldMappings.sbm.testId] || '').split(',').map(s => s.trim()); tcIds.forEach(id => { if (!acc[id]) acc[id] = []; acc[id].push(bug); }); return acc; }, {});
        const bugsByTestIdB = (sbmDataB.length > 0 && fieldMappings.sbmB) ? sbmDataB.reduce((acc, bug) => { const tcIds = String(bug[fieldMappings.sbmB.testId] || '').split(',').map(s => s.trim()); tcIds.forEach(id => { if (!acc[id]) acc[id] = []; acc[id].push(bug); }); return acc; }, {}) : {};

        return topicTmsData.map(tmsRecord => {
            const testId = String(tmsRecord[fieldMappings.tms.testId]);
            const testGroup = testIdToGroupMap.get(testId);
            if (!testGroup) return null;

            let bugs = bugsByTestId[testId] || [];
            let bugsB = (sbmDataB.length > 0 && fieldMappings.sbmB) ? (bugsByTestIdB[testId] || []) : [];

            if (isRealRisk) {
                if(fieldMappings.sbm.issueA) bugs = bugs.filter(b => String(b[fieldMappings.sbm.issueA]) !== '1');
                if(fieldMappings.sbmB?.issueB) bugsB = bugsB.filter(b => String(b[fieldMappings.sbmB.issueB]) !== '1');
            }

            const gatingBugsCount = bugs.filter(b => b[fieldMappings.sbm.gating] === 'Gating').length;
            const closedCriticalCount = bugs.filter(b => ['Gating', 'Gating Candidate'].includes(b[fieldMappings.sbm.gating]) && b[fieldMappings.sbm.state] === 'Closed - Child').length;
            const gatingBugsCountB = bugsB.length > 0 ? bugsB.filter(b => b[fieldMappings.sbmB.gating] === 'Gating').length : 0;
            const closedCriticalCountB = bugsB.length > 0 ? bugsB.filter(b => ['Gating', 'Gating Candidate'].includes(b[fieldMappings.sbmB.gating]) && b[fieldMappings.sbmB.state] === 'Closed - Child').length : 0;
            const bugAttrs = [...new Set(bugs.map(b => b[fieldMappings.sbm.bugAttribute]).filter(Boolean))];
            const coeff = bugAttrs.length === 1 && bugAttrs[0] === 'AP' ? weights.coeffAp : weights.coeffOther;
            const riskScore = ((gatingBugsCount * weights.gating) + (closedCriticalCount * weights.critical)) * coeff + (tmsRecord[fieldMappings.tms.manualIssueGrade] === 'Gating_CSC' ? weights.complaint : 0) + (tmsRecord[fieldMappings.tms.sanityManual] === 'Y' ? weights.sanity : 0);
            
            return { testId, testGroup, gatingBugsCount, closedCriticalCount, gatingBugsCountB, closedCriticalCountB, bugAttributes: bugAttrs.join(', '), riskScore, manualIssueGrade: tmsRecord[fieldMappings.tms.manualIssueGrade] || '', sanityManual: tmsRecord[fieldMappings.tms.sanityManual] || '', manualTimeSpent: parseFloat(tmsRecord[fieldMappings.tms.manualTimeSpent]) || 0 };
        }).filter(Boolean);
    }, [currentTopic, topicData, tmsData, sbmData, sbmDataB, fieldMappings, weights, isRealRisk, testIdToGroupMap]);

    // [FIX] Final logic for stable sorting
    const [displayedData, setDisplayedData] = useState([]);
    const isInitialMountOrFilterChange = useRef(true);

    useEffect(() => {
        console.log("[LOG] Filter or sort config changed. Flagging for re-sort.");
        isInitialMountOrFilterChange.current = true;
    }, [currentTopic, currentTestGroup, sortConfig]);

    useEffect(() => {
        const masterDataMap = new Map(calculatedMasterData.map(item => [item.testId, item]));

        if (isInitialMountOrFilterChange.current) {
            console.log("[LOG] Applying full filter and sort.");
            const filtered = currentTestGroup === 'all'
                ? calculatedMasterData
                : calculatedMasterData.filter(item => item.testGroup === currentTestGroup);

            const sorted = [...filtered].sort((a, b) => {
                const valA = a[sortConfig.key];
                const valB = b[sortConfig.key];
                const comparison = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
                return sortConfig.direction === 'asc' ? comparison : -comparison;
            });
            setDisplayedData(sorted);
            isInitialMountOrFilterChange.current = false;
        } else {
            console.log("[LOG] Applying value-only update. Preserving order.");
            console.log("Before update order (top 5):", displayedData.slice(0, 5).map(i => i.testId));
            setDisplayedData(prevData => {
                const newData = prevData.map(oldItem => masterDataMap.get(oldItem.testId) || oldItem);
                console.log("After update order (top 5):", newData.slice(0, 5).map(i => i.testId));
                return newData;
            });
        }
    }, [calculatedMasterData, currentTopic, currentTestGroup, sortConfig]);


    const selectionSummary = useMemo(() => {
        const selectedItems = displayedData.filter(item => selectedIds.has(item.testId));
        const time = selectedItems.reduce((sum, item) => sum + (item.manualTimeSpent || 0), 0);
        return { count: selectedIds.size, totalTime: time, totalHours: (time / 60).toFixed(2), items: selectedItems };
    }, [selectedIds, displayedData]);

    // --- Event Handlers ---
    const handleSort = useCallback((key) => {
        setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
    }, []);

    const handleSelect = useCallback((id) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }, []);
    
    const handleSelectAll = useCallback((e) => {
        setSelectedIds(e.target.checked ? new Set(displayedData.map(item => item.testId)) : new Set());
    }, [displayedData]);

    const handleDownload = useCallback((format) => {
        if (format === 'csv') {
            const dataToDownload = displayedData.map(d => ({
                '測試群組': d.testGroup, 'Test ID': d.testId, 'Gating Bugs': d.gatingBugsCount, 'Closed Critical': d.closedCriticalCount, 'B公司 Gating': sbmDataB.length > 0 ? d.gatingBugsCountB : 'N/A', 'B公司 Closed': sbmDataB.length > 0 ? d.closedCriticalCountB : 'N/A', '客訴': d.manualIssueGrade, 'SANITY': d.sanityManual, 'BugAttr': d.bugAttributes, '花費時間(分)': d.manualTimeSpent, '風險分數': d.riskScore.toFixed(2)
            }));
            downloadData(dataToDownload, `priority_table_${currentTopic}.csv`, 'csv');
        } else if (format === 'selected_ids') {
            downloadData(Array.from(selectedIds), `selected_ids_${currentTopic}.txt`, 'txt');
        }
    }, [displayedData, selectedIds, sbmDataB.length, currentTopic]);

    const allFilesLoaded = fileStatus.tms?.message && !fileStatus.tms.isError && fileStatus.sbm?.message && !fileStatus.sbm.isError && fileStatus.topic?.message && !fileStatus.topic.isError;
    
    // --- Render ---
    return (
        <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
            <FieldMappingModal show={modalState.show} onClose={handleModalClose} onConfirm={handleModalConfirm} modalState={modalState} />
            <div className="max-w-7xl mx-auto">
                <header className="mb-6">
                    <h1 className="text-3xl font-bold text-gray-800">測試案例分析儀表板 (排序穩定最終版)</h1>
                    <p className="text-gray-500 mt-1">整合測試案例、錯誤報告與分析文件，以優化測試優先級與策略。</p>
                    <nav className="mt-4 border-b border-gray-200"><div className="flex space-x-8">
                        <a onClick={() => setView('priority')} className={`cursor-pointer py-3 px-1 text-sm font-medium border-b-2 ${view === 'priority' ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>測試案例優先級</a>
                        <a onClick={() => setView('topic')} className={`cursor-pointer py-3 px-1 text-sm font-medium border-b-2 ${view === 'topic' ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Topic Issue 佔比分析</a>
                    </div></nav>
                </header>

                <div style={{display: view === 'priority' ? 'block' : 'none'}}>
                    <Card title="1. 設定與資料上傳">
                        {!librariesLoaded && <div className="text-center p-4 bg-yellow-100 text-yellow-800 rounded-lg mb-4">正在載入必要的函式庫...</div>}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <FileUploader id="tms" label="TMSTestcase" description="測試案例清單" onFileSelect={(e) => processAndSetFiles(e.target.files, 'tms')} status={fileStatus.tms} icon={<svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>} disabled={!librariesLoaded} />
                            <FileUploader id="sbm" label="SBMBugs" description="A 公司 Bug" onFileSelect={(e) => processAndSetFiles(e.target.files, 'sbm')} status={fileStatus.sbm} icon={<svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>} disabled={!librariesLoaded} />
                            <FileUploader id="topic" label="TestGroup" description="測試群組與測項對應" onFileSelect={(e) => processAndSetFiles(e.target.files, 'topic', true)} status={fileStatus.topic} icon={<svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>} multiple={true} disabled={!librariesLoaded} />
                            <FileUploader id="sbmB" label="SBMBugs_B" description="B 公司 Bug (選填)" onFileSelect={(e) => processAndSetFiles(e.target.files, 'sbmB')} status={fileStatus.sbmB} icon={<svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>} disabled={!librariesLoaded} />
                        </div>
                    </Card>
                    
                    <Card title="2. 風險評估權重設定"><WeightSettings weights={weights} onWeightChange={setWeights} /></Card>

                    <Card title="3. 測試案例優先等級表">
                        {!allFilesLoaded ? <div className="text-center py-10 text-gray-500">請先上傳所有必需的檔案。</div> :
                        (<>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 items-end">
                                <div><label htmlFor="topic-filter" className="block text-sm font-medium text-gray-700 mb-1">篩選 Topic 群組</label><select id="topic-filter" value={currentTopic} onChange={e => setCurrentTopic(e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm"><option value="">選擇 Topic</option>{Object.keys(topicData).sort().map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                                <div><label htmlFor="test-group-filter" className="block text-sm font-medium text-gray-700 mb-1">篩選測試群組</label><select id="test-group-filter" value={currentTestGroup} onChange={e => setCurrentTestGroup(e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm" disabled={!currentTopic}><option value="all">所有測試群組</option>{currentTopic && [...new Set((topicData[currentTopic] || []).map(item => item.testGroup))].sort().map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                                <div><button onClick={() => handleDownload('csv')} className="w-full py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700">下載表格 (CSV)</button></div>
                                <div className="flex items-center justify-start pb-1"><input type="checkbox" id="real-risk-checkbox" checked={isRealRisk} onChange={e => setIsRealRisk(e.target.checked)} className="h-5 w-5 text-blue-600 border-gray-300 rounded" /><label htmlFor="real-risk-checkbox" className="ml-2 block text-sm font-medium text-gray-700 whitespace-nowrap">真實風險</label></div>
                            </div>
                            <PriorityTable data={displayedData} onSort={handleSort} sortConfig={sortConfig} selectedIds={selectedIds} onSelect={handleSelect} onSelectAll={handleSelectAll} showCompanyB={sbmDataB.length > 0} />
                            <div className="mt-4 p-3 bg-gray-100 rounded-lg flex justify-between items-center font-semibold">
                                <span>已選取: <span className="text-blue-600">{selectionSummary.count}</span> 個測項 / 預估總工時: <span className="text-blue-600">{selectionSummary.totalHours}</span> 小時</span>
                                <button onClick={() => handleDownload('selected_ids')} className="py-1 px-3 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700" disabled={selectionSummary.count === 0}>下載已選取 ID</button>
                            </div>
                        </>)}
                    </Card>
                    {allFilesLoaded && currentTopic && <StrategicPlan currentTableData={displayedData} sbmData={sbmData} fieldMappings={fieldMappings} currentTopic={currentTopic} tmsData={tmsData} />}
                </div>
                
                <TopicAnalysisView tmsData={tmsData} sbmData={sbmData} fieldMappings={fieldMappings} isVisible={view === 'topic'} allFilesLoaded={allFilesLoaded} />
            </div>
        </div>
    );
}

