// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SimpleReputation
 * @notice 简化版 ERC-8004 信誉系统
 * @dev 专为 Pactum Agent 市场设计
 */
contract SimpleReputation {
    struct Agent {
        string name;
        string endpoint;  // Agent URL
        address owner;
        uint256 totalRating;  // 累计评分 (1-5 的总和)
        uint256 reviewCount;  // 评价数量
        bool active;
    }

    // agentId → Agent 数据
    mapping(bytes32 => Agent) public agents;

    // 防止重复评价: agentId → reviewer → 是否已评价
    mapping(bytes32 => mapping(address => bool)) public hasReviewed;

    event AgentRegistered(
        bytes32 indexed agentId,
        string name,
        string endpoint,
        address indexed owner
    );

    event ReviewSubmitted(
        bytes32 indexed agentId,
        address indexed reviewer,
        uint8 rating,
        string commentHash  // IPFS hash (可选)
    );

    event AgentUpdated(
        bytes32 indexed agentId,
        string newEndpoint
    );

    /**
     * @notice 注册新 Agent
     * @param agentId Agent 的唯一 ID (推荐用 keccak256(name + owner))
     * @param name Agent 名称
     * @param endpoint Agent 的 A2A 端点 URL
     */
    function registerAgent(
        bytes32 agentId,
        string memory name,
        string memory endpoint
    ) external {
        require(!agents[agentId].active, "Agent already registered");
        require(bytes(name).length > 0, "Name cannot be empty");
        require(bytes(endpoint).length > 0, "Endpoint cannot be empty");

        agents[agentId] = Agent({
            name: name,
            endpoint: endpoint,
            owner: msg.sender,
            totalRating: 0,
            reviewCount: 0,
            active: true
        });

        emit AgentRegistered(agentId, name, endpoint, msg.sender);
    }

    /**
     * @notice 提交评价
     * @param agentId Agent ID
     * @param rating 评分 (1-5)
     * @param commentHash 评论的 IPFS hash (可选,传空字符串表示无评论)
     */
    function submitReview(
        bytes32 agentId,
        uint8 rating,
        string memory commentHash
    ) external {
        require(rating >= 1 && rating <= 5, "Rating must be 1-5");
        require(agents[agentId].active, "Agent not found");
        require(!hasReviewed[agentId][msg.sender], "Already reviewed this agent");

        agents[agentId].totalRating += rating;
        agents[agentId].reviewCount += 1;
        hasReviewed[agentId][msg.sender] = true;

        emit ReviewSubmitted(agentId, msg.sender, rating, commentHash);
    }

    /**
     * @notice 更新 Agent 端点 (仅 owner 可调用)
     * @param agentId Agent ID
     * @param newEndpoint 新的端点 URL
     */
    function updateAgentEndpoint(
        bytes32 agentId,
        string memory newEndpoint
    ) external {
        require(agents[agentId].active, "Agent not found");
        require(agents[agentId].owner == msg.sender, "Not agent owner");
        require(bytes(newEndpoint).length > 0, "Endpoint cannot be empty");

        agents[agentId].endpoint = newEndpoint;
        emit AgentUpdated(agentId, newEndpoint);
    }

    /**
     * @notice 获取 Agent 统计数据
     * @param agentId Agent ID
     * @return avgRating 平均分 * 100 (例如 450 表示 4.50 分)
     * @return reviewCount 评价总数
     * @return endpoint Agent 端点
     */
    function getAgentStats(bytes32 agentId) external view returns (
        uint256 avgRating,
        uint256 reviewCount,
        string memory endpoint
    ) {
        Agent memory agent = agents[agentId];
        require(agent.active, "Agent not found");

        if (agent.reviewCount == 0) {
            return (0, 0, agent.endpoint);
        }

        avgRating = (agent.totalRating * 100) / agent.reviewCount;
        reviewCount = agent.reviewCount;
        endpoint = agent.endpoint;
    }

    /**
     * @notice 检查 Agent 是否存在
     */
    function isAgentActive(bytes32 agentId) external view returns (bool) {
        return agents[agentId].active;
    }

    /**
     * @notice 检查用户是否已评价某个 Agent
     */
    function hasUserReviewed(bytes32 agentId, address user) external view returns (bool) {
        return hasReviewed[agentId][user];
    }
}
