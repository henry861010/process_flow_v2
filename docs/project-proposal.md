# Process Flow 共通語言 PoC 計畫書

## 1. 專案摘要

本 PoC 目標是建立一套以 process flow 為核心的共通描述語言，讓 simulation team 能用站點層級描述封裝製程中的 process state，並讓 integration team 對關鍵資訊建立一致理解。

V1 不追求自動模擬真實製程，也不直接產出 FEM-ready geometry。這一版先建立可追溯、可版本化的 process-state workflow，讓團隊能在模型建立前先對「每一站的輸入、輸出、參數與 geometry reference」有一致理解。

## 2. 背景與問題

Simulation team 目前常以 final package geometry 作為建模入口，例如 molding 厚度、die placement、underfill 高度或 final package dimension。這種做法在產品尚未完整定義、製程仍在演進時，容易讓 simulation、integration、module team 對同一個結構狀態產生不同解讀。

實際上，wafer 到 final package 的狀態是由一連串 process station 逐步形成。若缺少共同語言，simulation engineer 需要反覆訪談與查文件，也難以清楚追蹤目前建模使用的 geometry 與參數分別對應到哪個 process state。

## 3. 解法概覽

PoC 會用 process flow template 描述一種封裝技術平台的標準流程，例如 xxxTech、yyyTech 或 zzzTech。這裡的 TV 指 test vehicle。當有特定 TV/Product，例如 aaaTV 或 bbbTV，系統會從對應 template 建立 process flow instance，讓工程師在每個站點填入實際 value，並綁定必要的 geometry reference。

核心設計原則是「站點與欄位定義可共用，產品實際值存在 instance」。相同 process station 例如 molding、underfill、die attach，不應在不同封裝技術中重複定義出語意不同的欄位。這能降低欄位命名漂移，也讓跨產品與跨封裝技術的比較更一致。

Process flow template 一旦建立即視為不可變的流程快照。若同一封裝技術平台後續需要新的流程定義，需建立新的 `processFlowTemplateId`；若仍屬於同一流程家族，則使用相同 `templateFamilyId` 串接，例如 cowosl v1.0 與 cowosl v2.0 會有不同 `processFlowTemplateId`，但共享相同 `templateFamilyId`。

## 4. 主要使用情境

### 4.1 新封裝技術開發

當團隊正在開發新封裝技術時，simulation engineer 可以從既有 process station library 選用常見站點，例如 incoming wafer、die attach、underfill、molding、final package state。若現有站點不足，再與 integration team 一起定義新的站點與必要欄位。

### 4.2 既有封裝技術的新 TV/Product

當新 TV/Product 屬於既有封裝技術，例如 aaaTV 或 bbbTV 都使用 xxxTech 平台時，工程師不需要重新搭建整條 process flow。系統可從 xxxTech process flow template 建立 instance，並讓 simulation engineer 只針對該 TV/Product 補入 geometry reference 與站點 value。

## 5. V1 範圍

- 建立一套 process flow 描述語言，能描述站點、站點順序或有向流程拓樸、站點欄位與 TV/Product 實際值。
- 建立代表性的 xxxTech process flow template。
- 建立 aaaTV 與 bbbTV sample instance，示範同一流程下不同 TV/Product 的差異。
- 提供 UI 操作 process flow template selection、instance creation、process timeline 與 step detail editing。

## 6. 預期效益

- 降低 simulation 與 integration 對 process state 的溝通成本。
- 讓新進工程師能從單一流程理解 package state 如何形成，而不是只靠零散文件與口頭傳承。
- 讓同一封裝技術下不同 TV/Product 的差異可比較。
- 讓不同封裝技術可共用相同 process station 定義，減少重複建置與欄位定義漂移。
- 為未來 geometry automation 與 FEM preprocessing 建立可追溯資料基礎。

## 7. 成功指標

- Simulation engineer 可在 30 分鐘內由既有 process flow template 建立新 TV/Product flow skeleton。
- 任一 process station 都能查到當下 input/output geometry state、port mapping 與 parameter values。
- xxxTech、yyyTech、zzzTech 可共用語意一致的 molding station 定義。
- 已建立 instance 能追溯其建立時使用的流程版本與站點定義版本。
- 至少完成一個 xxxTech process flow 與兩個 TV/Product instance 的端到端示範。
