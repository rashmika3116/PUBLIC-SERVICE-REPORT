const $ = (selector) => document.querySelector(selector);

const reportForm = $("#report-form");
const reportMessage = $("#report-message");
const trackMessage = $("#track-message");
const trackingResult = $("#tracking-result");
const adminDialog = $("#admin-dialog");
const adminDashboard = $("#admin-dashboard");

let adminReports = [];

function showMessage(element, message, type = "") {
    element.textContent = message;
    element.className = `message ${type}`.trim();
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function statusClass(status) {
    return String(status || "")
        .toLowerCase()
        .replace(/\s+/g, "-");
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Unknown date"
        : date.toLocaleString();
}

// Submit a new issue
reportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(reportMessage, "");

    const button = reportForm.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "Submitting...";

    const payload = Object.fromEntries(
        new FormData(reportForm).entries()
    );

    try {
        const response = await fetch("/api/issues", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Submission failed.");
        }

        showMessage(
            reportMessage,
            `Report submitted! ID: ${data.reportId}. ` +
            `Tracking code: ${data.trackingCode}. Save both values.`,
            "success"
        );

        $("#report-id").value = data.reportId;
        $("#tracking-code").value = data.trackingCode;
        reportForm.reset();
    } catch (error) {
        showMessage(reportMessage, error.message, "error");
    } finally {
        button.disabled = false;
        button.textContent = "Submit Report";
    }
});

// Track an issue
$("#track-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    showMessage(trackMessage, "");
    trackingResult.hidden = true;

    const reportId = $("#report-id").value.trim();
    const trackingCode = $("#tracking-code").value.trim();

    try {
        const response = await fetch(
            `/api/issues/${encodeURIComponent(reportId)}/track`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ trackingCode })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Report not found.");
        }

        const issue = data.issue;

        trackingResult.innerHTML = `
            <h3>${escapeHTML(issue.title)}</h3>
            <p><strong>Report ID:</strong>
                ${escapeHTML(issue.report_id)}</p>
            <p><strong>Status:</strong>
                <span class="status">
                    ${escapeHTML(issue.status)}
                </span>
            </p>
            <p><strong>Category:</strong>
                ${escapeHTML(issue.category)}</p>
            <p><strong>Location:</strong>
                ${escapeHTML(issue.location)}</p>
            <p><strong>Submitted:</strong>
                ${escapeHTML(formatDate(issue.created_at))}</p>
            ${issue.team_name ? `
                <p><strong>Assigned Team:</strong>
                    ${escapeHTML(issue.team_name)}</p>` : ""}
            ${issue.resolution_note ? `
                <p><strong>Update:</strong>
                    ${escapeHTML(issue.resolution_note)}</p>` : ""}
        `;

        trackingResult.hidden = false;
    } catch (error) {
        showMessage(trackMessage, error.message, "error");
    }
});

// Open administrator login
$("#admin-open").addEventListener("click", () => {
    showMessage($("#login-message"), "");
    adminDialog.showModal();
});

// Administrator login
$("#admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const response = await fetch("/api/admin/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                password: $("#admin-password").value
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Login failed.");
        }

        adminDialog.close();
        $("#admin-password").value = "";
        adminDashboard.hidden = false;

        adminDashboard.scrollIntoView({
            behavior: "smooth"
        });

        await loadAdminReports();
    } catch (error) {
        showMessage($("#login-message"), error.message, "error");
    }
});

// Administrator logout
$("#admin-logout").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    adminDashboard.hidden = true;
});

// Load reports for the administrator
async function loadAdminReports() {
    const container = $("#admin-reports");
    container.innerHTML =
        '<div class="empty-state">Loading reports...</div>';

    try {
        const response = await fetch("/api/admin/issues");
        const data = await response.json();

        if (response.status === 401) {
            adminDashboard.hidden = true;
            throw new Error("Please log in again.");
        }

        if (!response.ok) {
            throw new Error(data.error || "Unable to load reports.");
        }

        adminReports = data.issues;
        renderStats(data.stats);
        renderAdminReports();
    } catch (error) {
        container.textContent = error.message;
    }
}

function renderStats(stats = {}) {
    const statuses = [
        "Submitted",
        "In Progress",
        "Resolved",
        "Rejected"
    ];

    $("#admin-stats").innerHTML = statuses.map(status => `
        <div class="admin-stat">
            <span>${escapeHTML(status)}</span>
            <strong>${Number(stats[status] || 0)}</strong>
        </div>
    `).join("");
}

// Search and filter reports
$("#admin-search").addEventListener("input", renderAdminReports);
$("#admin-filter").addEventListener("change", renderAdminReports);
$("#refresh-reports").addEventListener("click", loadAdminReports);

function renderAdminReports() {
    const query = $("#admin-search").value.toLowerCase().trim();
    const selectedStatus = $("#admin-filter").value;

    const reports = adminReports.filter(issue => {
        const searchable =
            `${issue.title} ${issue.category} ` +
            `${issue.location} ${issue.report_id}`.toLowerCase();

        return searchable.includes(query) &&
            (!selectedStatus || issue.status === selectedStatus);
    });

    const container = $("#admin-reports");

    if (!reports.length) {
        container.innerHTML =
            '<div class="empty-state">No reports found.</div>';
        return;
    }

    container.innerHTML = reports.map(issue => `
        <article class="issue-card">
            <h3>${escapeHTML(issue.title)}</h3>
            <div class="issue-meta">
                ${escapeHTML(issue.report_id)} ·
                ${escapeHTML(issue.category)} ·
                ${escapeHTML(formatDate(issue.created_at))}
            </div>

            <p>${escapeHTML(issue.description)}</p>
            <p><strong>Location:</strong>
                ${escapeHTML(issue.location)}</p>

            <div class="issue-controls">
                <div>
                    <label for="status-${escapeHTML(issue.id)}">
                        Status
                    </label>
                    <select id="status-${escapeHTML(issue.id)}">
                        ${["Submitted", "In Progress", "Resolved", "Rejected"]
                            .map(status => `
                                <option ${status === issue.status ? "selected" : ""}>
                                    ${status}
                                </option>
                            `).join("")}
                    </select>
                </div>

                <div>
                    <label for="team-${escapeHTML(issue.id)}">Team</label>
                    <input id="team-${escapeHTML(issue.id)}"
                        value="${escapeHTML(issue.team_name || "")}"
                        placeholder="Maintenance team">
                </div>

                <div>
                    <label for="note-${escapeHTML(issue.id)}">
                        Progress note
                    </label>
                    <input id="note-${escapeHTML(issue.id)}"
                        value="${escapeHTML(issue.resolution_note || "")}"
                        placeholder="Enter update">
                </div>

                <button class="primary-btn save-issue"
                    data-id="${escapeHTML(issue.id)}">
                    Save
                </button>
            </div>
        </article>
    `).join("");

    container.querySelectorAll(".save-issue").forEach(button => {
        button.addEventListener("click", saveIssue);
    });
}

// Save administrator changes
async function saveIssue(event) {
    const id = event.currentTarget.dataset.id;
    const button = event.currentTarget;

    const payload = {
        status: $(`#status-${CSS.escape(id)}`).value,
        teamName: $(`#team-${CSS.escape(id)}`).value.trim(),
        resolutionNote: $(`#note-${CSS.escape(id)}`).value.trim()
    };

    button.disabled = true;
    button.textContent = "Saving...";

    try {
        const response = await fetch(
            `/api/admin/issues/${encodeURIComponent(id)}`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not save changes.");
        }

        showMessage(
            $("#admin-message"),
            "Issue updated successfully.",
            "success"
        );

        await loadAdminReports();
    } catch (error) {
        showMessage($("#admin-message"), error.message, "error");
    } finally {
        button.disabled = false;
        button.textContent = "Save";
    }
}