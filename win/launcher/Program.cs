// Marinara Engine — Windows taskbar-grouping launcher
//
// Runs the Marinara Engine batch file in a console that's owned by this
// executable, so the running window's AppUserModelID matches the pinned
// Start Menu / taskbar shortcut and groups under it correctly.
//
// Build: csc /target:winexe /platform:x64 /out:MarinaraLauncher.exe Program.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

internal static class Program
{
    [DllImport("shell32.dll", PreserveSig = false)]
    private static extern void SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string AppID);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AllocConsole();

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    private static extern bool SetWindowText(IntPtr hWnd, string lpString);

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        int GetCount(out uint cProps);
        int GetAt(uint iProp, out PROPERTYKEY pkey);
        int GetValue(ref PROPERTYKEY key, [Out] PROPVARIANT pv);
        int SetValue(ref PROPERTYKEY key, [In] PROPVARIANT pv);
        int Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential, Size = 24)]
    private class PROPVARIANT
    {
        public ushort vt;
        public ushort r1, r2, r3;
        public IntPtr ptr;
        public IntPtr extra;

        public void SetString(string s)
        {
            vt = 31; // VT_LPWSTR
            ptr = Marshal.StringToCoTaskMemUni(s);
        }

        public void Clear()
        {
            if (ptr != IntPtr.Zero) Marshal.FreeCoTaskMem(ptr);
            ptr = IntPtr.Zero;
            vt = 0;
        }
    }

    [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPersistFile
    {
        int GetClassID(out Guid pClassID);
        int IsDirty();
        int Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
        int Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, [MarshalAs(UnmanagedType.Bool)] bool fRemember);
        int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
        int GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class CShellLink { }

    private static readonly Guid PKEY_AUMID_FMTID = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    private const uint PKEY_AUMID_PID = 5;

    private static int Main(string[] args)
    {
        if (args.Length >= 1 && args[0] == "--stamp-lnk")
        {
            if (args.Length < 3) return 2;
            return StampLnk(args[1], args[2]);
        }

        if (args.Length < 2) return 2;
        return RunBat(args[0], args[1], args.Length >= 3 ? args[2] : Path.GetFileName(args[1]));
    }

    private static int StampLnk(string lnkPath, string aumid)
    {
        try
        {
            object linkObj = new CShellLink();
            try
            {
                ((IPersistFile)linkObj).Load(lnkPath, 2); // STGM_READWRITE
                var store = (IPropertyStore)linkObj;
                var key = new PROPERTYKEY { fmtid = PKEY_AUMID_FMTID, pid = PKEY_AUMID_PID };
                var pv = new PROPVARIANT();
                pv.SetString(aumid);
                store.SetValue(ref key, pv);
                store.Commit();
                pv.Clear();
                ((IPersistFile)linkObj).Save(lnkPath, true);
            }
            finally
            {
                Marshal.FinalReleaseComObject(linkObj);
            }
            return 0;
        }
        catch
        {
            return 1;
        }
    }

    private static int RunBat(string aumid, string batPath, string title)
    {
        SetCurrentProcessExplicitAppUserModelID(aumid);
        AllocConsole();

        IntPtr hwnd = GetConsoleWindow();
        if (hwnd != IntPtr.Zero)
        {
            SetWindowText(hwnd, title);
        }

        var psi = new ProcessStartInfo
        {
            FileName = Environment.ExpandEnvironmentVariables("%ComSpec%"),
            Arguments = "/k \"\"" + batPath + "\"\"",
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(batPath) ?? Environment.CurrentDirectory,
        };

        try
        {
            using (var proc = Process.Start(psi))
            {
                if (proc == null) return 3;
                proc.WaitForExit();
                return proc.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            Console.Error.WriteLine("Press any key to exit...");
            Console.ReadKey(true);
            return 4;
        }
    }
}
